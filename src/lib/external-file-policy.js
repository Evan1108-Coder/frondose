/** Content-only reconciliation; filesystem authority always comes from a fresh GET. */
export const EXTERNAL_FILE_DEFAULTS = Object.freeze({ autoReload: true, autoMerge: false, recovery: true });
export function normalizeExternalFileSettings(value) {
  return Object.fromEntries(Object.entries(EXTERNAL_FILE_DEFAULTS).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
}
export function externalFileScope(workspaceId, rootVersion, path) { return JSON.stringify([workspaceId, rootVersion, path]); }
export function generatedMergeReview(path) { return /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|Pipfile\.lock|go\.sum)$/i.test(path); }
export function diskReadOnly(disk) { return disk?.read_only === true || (Number.isInteger(disk?.mode) && (disk.mode & 0o222) === 0); }
export function sameDraft(left, right) { return left.path === right.path && left.revision === right.revision && left.content === right.content && left.version === right.version && left.baseline === right.baseline; }
export function adoptDisk(draft, disk, content = disk.content, now = Date.now()) {
  if (typeof disk.content !== 'string' || disk.unsupported) throw Error('This disk file cannot be edited as text.');
  return { ...draft, baseline: disk.content, content, version: disk.version, modified_at: disk.modified_at, modeBits: disk.mode,
    loaded: true, isNew: false, discarded: false, error: null, revision: draft.revision + 1,
    selectionStart: Math.min(draft.selectionStart ?? 0, content.length), selectionEnd: Math.min(draft.selectionEnd ?? 0, content.length),
    timeline: [...(draft.timeline || []).filter(item => item.version !== disk.version), { version: disk.version, modified_at: disk.modified_at }].slice(-20),
    diskState: { status: diskReadOnly(disk) ? 'readonly' : 'current', checkedAt: now } };
}
export function reconcileDisk(draft, disk, settings = EXTERNAL_FILE_DEFAULTS, now = Date.now()) {
  if (draft.isNew || !draft.loaded || draft.pending || draft.discarded) return draft;
  if (disk.unsupported || typeof disk.content !== 'string') return { ...draft, diskState: { status: 'unsupported', checkedAt: now } };
  if (disk.content === draft.baseline) return { ...draft, version: disk.version, modified_at: disk.modified_at, modeBits: disk.mode, diskState: { status: diskReadOnly(disk) ? 'readonly' : 'current', checkedAt: now } };
  if (disk.content === draft.content || (draft.content === draft.baseline && settings.autoReload)) return adoptDisk(draft, disk, disk.content, now);
  return { ...draft, diskState: { status: 'changed', snapshot: disk, checkedAt: now } };
}
export function saveDiskDecision(sent, disk) {
  if (disk.unsupported || typeof disk.content !== 'string') return 'unsupported';
  if (diskReadOnly(disk)) return 'readonly';
  if (disk.content === sent.content) return 'already-saved';
  return disk.content === sent.baseline ? 'safe' : 'changed';
}
