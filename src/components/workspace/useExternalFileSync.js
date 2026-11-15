import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { directoryApiPath, directoryDraftDirty } from '../../lib/directory-drafts.js';
import { adoptDisk, externalFileScope, generatedMergeReview, reconcileDisk, sameDraft, saveDiskDecision } from '../../lib/external-file-policy.js';
import { useExternalFileSettings } from '../../lib/external-file-settings.js';
import { storeRecovery } from '../../lib/file-recovery.js';
import { mergeFileInWorker } from '../../lib/file-merge-worker.js';
import { renderFileMerge } from '../../lib/file-merge.js';

export function useExternalFileSync({ workspaceId, rootVersion, draft, state, update, owner }) {
  const [settings] = useExternalFileSettings(), latest = useRef(settings); latest.current = settings;
  const [open, setOpen] = useState(false), openRef = useRef(open); openRef.current = open;
  const [busy, setBusy] = useState(false), [recoveryError, setRecoveryError] = useState('');
  const scope = externalFileScope(workspaceId, rootVersion, draft.path);
  const life = useRef(null), inFlight = useRef(null), applying = useRef(false), attempted = useRef('');
  const readDisk = useCallback(async signal => {
    const { result } = await apiRequest(directoryApiPath(workspaceId, 'file', { path: state.current.path, expected_binding_version: rootVersion }), { signal });
    return result;
  }, [workspaceId, rootVersion, state]);
  const backup = useCallback(async (captured, reason, disk) => {
    if (!latest.current.recovery) return;
    await storeRecovery(externalFileScope(workspaceId, rootVersion, captured.path), captured, reason, disk);
  }, [workspaceId, rootVersion]);
  // Applying a comparison only changes the draft. A later explicit Save still
  // needs the backend's atomic version checks. Never restore a recovery version.
  const apply = useCallback(async (captured, expectedDisk, content, reason = 'before merge') => {
    const controller = life.current;
    if (!controller || controller.signal.aborted || applying.current || state.current.pending) return false;
    applying.current = true; setBusy(true);
    try {
      if (!sameDraft(state.current, captured)) throw Error('Your draft changed during review. Rebuild the comparison before applying.');
      await backup(captured, reason, expectedDisk);
      const disk = await readDisk(controller.signal);
      if (controller.signal.aborted || life.current !== controller) return false;
      if (!sameDraft(state.current, captured) || disk.version !== expectedDisk.version || disk.content !== expectedDisk.content) {
        update(value => reconcileDisk(value, disk, { ...latest.current, autoReload: false }));
        throw Error('The file or your draft changed during review. Nothing was replaced. Rebuild the comparison.');
      }
      update(value => adoptDisk(value, disk, content)); setRecoveryError(''); return true;
    } finally { applying.current = false; if (life.current === controller && !controller.signal.aborted) setBusy(false); }
  }, [backup, readDisk, state, update]);
  const check = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const controller = life.current;
    if (!controller || controller.signal.aborted || !state.current.loaded || state.current.isNew || state.current.pending || applying.current) return Promise.resolve(null);
    const operation = (async () => {
      try {
        const disk = await readDisk(controller.signal);
        if (controller.signal.aborted || life.current !== controller || state.current.pending || applying.current) return null;
        const captured = { ...state.current };
        const next = reconcileDisk(captured, disk, openRef.current ? { ...latest.current, autoReload: false } : latest.current);
        if (next.content !== captured.content) {
          update(value => reconcileDisk(value, disk, { ...latest.current, autoReload: false }));
          await backup(captured, 'before automatic reload', disk);
          if (controller.signal.aborted || life.current !== controller || state.current.pending || !sameDraft(state.current, captured)) return disk;
        }
        update(value => reconcileDisk(value, disk, openRef.current ? { ...latest.current, autoReload: false } : latest.current));
        const current = state.current, attempt = JSON.stringify([disk.version, current.revision]);
        if (current.diskState?.status === 'changed' && latest.current.autoMerge && !openRef.current && !generatedMergeReview(current.path) && attempted.current !== attempt) {
          attempted.current = attempt;
          const original = { ...current }, plan = await mergeFileInWorker(original.baseline, original.content, disk.content, controller.signal);
          const merged = renderFileMerge(plan);
          if (!merged.unresolved && !controller.signal.aborted && life.current === controller && latest.current.autoMerge && !openRef.current && sameDraft(state.current, original)) await apply(original, disk, merged.content, 'before automatic draft merge');
        }
        return disk;
      } catch (error) {
        if (controller.signal.aborted || life.current !== controller) return null;
        // Recovery/merge errors must not hide a known changed snapshot.
        if (state.current.diskState?.status === 'changed' || /recovery|comparison|merge/i.test(error.message)) setRecoveryError(error.message);
        else update(value => ({ ...value, diskState: { status: 'unavailable', checkedAt: Date.now(), message: error.message } }));
        return null;
      } finally { if (inFlight.current === operation) inFlight.current = null; }
    })();
    inFlight.current = operation; return operation;
  }, [apply, backup, readDisk, state, update]);
  useEffect(() => {
    const controller = new AbortController(); life.current = controller; attempted.current = ''; inFlight.current = null;
    let timer;
    const visible = () => !document.hidden && Boolean(owner.current?.getClientRects().length);
    const poll = async () => { if (visible()) await check(); if (!controller.signal.aborted) timer = setTimeout(poll, 3000); };
    const focused = () => { if (visible()) void check(); };
    void poll(); window.addEventListener('focus', focused); document.addEventListener('visibilitychange', focused);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', focused); };
  }, [scope, draft.loaded, check, owner]);
  useEffect(() => {
    if (!settings.recovery || !directoryDraftDirty(draft)) return;
    const captured = { ...draft };
    const timer = setTimeout(() => { backup(captured, 'unsaved draft').then(() => setRecoveryError('')).catch(error => setRecoveryError(error.message)); }, 800);
    return () => clearTimeout(timer);
  }, [scope, draft.content, draft.baseline, draft.isNew, settings.recovery, backup]);
  const beforeSave = async sent => {
    if (sent.isNew) return { version: null };
    if (applying.current) throw Error('Finish the file comparison first.');
    const controller = life.current;
    if (!controller || controller.signal.aborted) throw Error('This editor is no longer active.');
    const disk = await readDisk(controller.signal);
    if (controller.signal.aborted || life.current !== controller || !sameDraft(state.current, sent)) throw Error('The draft changed before saving. Try Save again.');
    const decision = saveDiskDecision(sent, disk);
    if (decision === 'safe' || decision === 'already-saved') return { version: disk.version, saved: decision === 'already-saved' ? disk : null };
    update(value => ({ ...value, diskState: { status: decision, snapshot: disk, checkedAt: Date.now() } }));
    setOpen(true);
    throw Error(decision === 'changed' ? 'The disk file changed. Compare the versions before saving.' : decision === 'readonly' ? 'The disk file has read-only permissions. Your draft is preserved.' : 'The disk file is no longer supported as editable text. Your draft is preserved.');
  };
  return { open, setOpen, scope, busy, recoveryError, settings, check, readDisk, apply, beforeSave, isApplying: () => applying.current };
}
