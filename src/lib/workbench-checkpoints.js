const HASH = /^[a-f0-9]{64}$/;

export function checkpointCapturePaths(text) {
  const paths = String(text || '').split(/\r?\n/).map(path => path.trim()).filter(Boolean);
  if (!paths.length || paths.length > 200) return { paths, error: 'Choose between 1 and 200 relative file paths, one per line.' };
  if (new Set(paths).size !== paths.length) return { paths, error: 'List each file path only once.' };
  if (paths.some(path => path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.'))) return { paths, error: 'Use paths relative to the linked project folder, without parent traversal.' };
  return { paths, error: '' };
}

export function checkpointRestoreBlock(preview, scope, checkpointId) {
  if (!preview || preview.checkpoint?.id !== checkpointId || preview.checkpoint.workspace_id !== scope.workspaceId || preview.checkpoint.project_id !== scope.projectId) return 'A current preview for this exact project checkpoint is required.';
  if (!Number.isSafeInteger(preview.checkpoint.version) || !HASH.test(preview.preview_fingerprint || '')) return 'The checkpoint version or preview fingerprint is unavailable.';
  const files = preview.files;
  if (!Array.isArray(files) || !files.length || files.length > 50 || new Set(files.map(file => file.path)).size !== files.length) return 'Preview between 1 and 50 distinct checkpoint files.';
  if (files.some(file => typeof file.path !== 'string' || !file.path || !['unchanged', 'restore', 'create', 'delete'].includes(file.operation))) return 'A selected path or proposed file operation is unavailable. Preview again.';
  if (preview.limited || files.some(file => file.restorable !== true || !['present', 'absent'].includes(file.before?.state) || !['present', 'absent'].includes(file.current?.state))) return 'Some selected files are unavailable or unsupported. Return to file selection and exclude them before previewing again.';
  if (files.some(file => [file.before, file.current].some(state => state.state === 'present' && typeof state.content !== 'string'))) return 'Exact text is unavailable for one or more selected files. No restore can be approved from incomplete text.';
  if (files.some(file => file.current.state === 'present' ? !HASH.test(file.current.sha256 || '') : file.current.sha256 !== null)) return 'One or more current file hashes are unavailable. Preview again; no state will be inferred.';
  if (files.some(file => file.current.state === 'present' ? !Number.isInteger(file.current.mode) || file.current.mode < 0 || file.current.mode > 0o777 : file.current.mode !== null)) return 'One or more current file modes are unavailable. Preview again before restoring.';
  if (files.every(file => file.operation === 'unchanged')) return 'The selected file contents and modes already match this checkpoint. No restore is needed.';
  return '';
}

export function checkpointRestorePayload(preview) {
  return {
    paths: preview.files.map(file => ({ path: file.path, expected_current_state: file.current.state, expected_current_sha256: file.current.sha256, expected_current_mode: file.current.mode })),
    preview_fingerprint: preview.preview_fingerprint,
    checkpoint_version: preview.checkpoint.version,
    confirmed: true,
  };
}

export function checkpointRestoreRequest(payload, previous, makeId) {
  const key = JSON.stringify(payload);
  const request = previous?.key === key ? previous : { key, id: makeId() };
  return { request, body: { ...payload, request_id: request.id } };
}

export function checkpointDeliveryUncertain(error) {
  return ['timeout', 'network_error', 'invalid_response'].includes(error?.code) || Number(error?.status) >= 500;
}

export function checkpointPreviewInvalidated(error) {
  return ['stale_worktree', 'stale_checkpoint', 'root_changed'].includes(error?.code);
}

export function checkpointComparison(preview) {
  return {
    source: 'workbench', title: 'Selected-file restore preview', base: 'Current working files', head: `Checkpoint ${preview.checkpoint.id}`,
    notice: 'Red lines will be removed from current files; green lines will be restored from the checkpoint. Mode-only changes are listed above even when there are no changed lines. This is not a Git reset or a claim of agent authorship.',
    limited: Boolean(preview.limited),
    files: preview.files.filter(file => file.operation !== 'unchanged' || !file.restorable).map(file => ({ path: file.path, status: file.operation === 'delete' ? 'deleted' : file.operation === 'create' ? 'added' : 'modified', patch: file.patch || '', unavailable: file.restorable ? null : file.reason || 'File unavailable; no change is inferred.' })),
  };
}

export function checkpointFileMode(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0o777 ? `0${value.toString(8).padStart(3, '0')}` : 'Not recorded';
}

export function checkpointRestoreOutcome(result) {
  if (result?.status === 'interrupted') return { title: 'Restore interrupted — final file state unknown', detail: 'The saved attempt was interrupted. Some files may have changed without a final outcome being recorded. Do not blindly reapply it; inspect current files and the pre-restore recovery checkpoint.' };
  if (result?.status === 'in_progress') return { title: 'Restore completion not confirmed', detail: 'This request is recorded as in progress. Do not start another restore or assume all files changed. Inspect the recorded result and current files before a new recovery decision.' };
  if (!result || !['completed', 'partial', 'failed'].includes(result.status)) return { title: 'Restore result unavailable', detail: 'Do not assume files were restored. Inspect the working tree before another attempt.' };
  if (result.status === 'partial') return { title: 'Restore partially completed', detail: 'Some selected files changed and others failed. This was not an atomic rollback; inspect each outcome before any further action.' };
  if (result.status === 'failed') return { title: 'Restore failed', detail: 'The recorded file applications failed. Inspect the per-file results and current files; no automatic recovery will run.' };
  return { title: 'Selected-file restore completed', detail: 'Only the listed files were handled. Unselected files, the Git index, commits and branches were not restored.' };
}
