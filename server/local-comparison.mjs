import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { textPatch } from '../src/lib/change-review.js';
import { validationError } from './validation.mjs';

export async function localComparison({ root, query, git, safeRelative, fileFor, readText }) {
  const mode = query.mode || 'working';
  if (!['working', 'staged', 'compare'].includes(mode)) throw validationError('Choose working, staged, or compare.');
  const ref = async value => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value)) throw validationError('Choose a branch, tag, or commit ID.');
    return (await git(root, ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`])).trim();
  };
  const base = mode === 'compare' ? await ref(query.base) : mode === 'staged' ? await git(root, ['rev-parse', '--verify', 'HEAD']).then(s => s.trim()).catch(() => null) : 'index';
  const head = mode === 'compare' ? await ref(query.head) : mode === 'staged' ? 'index' : 'working tree';
  const args = mode === 'compare' ? [base, head] : mode === 'staged' ? ['--cached'] : [];
  const names = (await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', ...args, '--'])).split('\0');
  const entries = [];
  for (let i = 0; i < names.length && names[i];) { const status = names[i++], oldPath = names[i++], renamed = /^[RC]/.test(status); entries.push({ path: renamed ? names[i++] : oldPath, oldPath, status }); }
  if (mode === 'working') for (const path of (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)) entries.push({ path, oldPath: path, status: '?' });
  const files = []; let hidden = 0, bytes = 0;
  for (const entry of entries.slice(0, 201)) {
    try { safeRelative(entry.path); safeRelative(entry.oldPath); } catch { hidden++; continue; }
    if (files.length === 200 || bytes > 2_000_000) break;
    try {
      try { const info = await lstat(resolve(root, entry.path)); if (info.isSymbolicLink()) { hidden++; continue; } await fileFor(root, entry.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const patch = entry.status === '?' ? textPatch('', (await readText(root, entry.path)).content) : await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--unified=10000', '-M', ...args, '--', entry.oldPath, ...(entry.oldPath !== entry.path ? [entry.path] : [])]);
      const unavailable = /Binary files|GIT binary patch/.test(patch) ? 'Binary file. No text diff is available.' : patch.length > 300_000 ? 'This file exceeds the 300 KB diff limit.' : null;
      bytes += unavailable ? 0 : patch.length;
      files.push({ ...entry, patch: unavailable ? '' : patch, unavailable });
    } catch { files.push({ ...entry, patch: '', unavailable: 'Preview unavailable: private, unreadable, binary, or over the file limit.' }); }
  }
  return { source: 'local', title: mode === 'compare' ? `${query.base} → ${query.head}` : mode === 'staged' ? 'Staged changes' : 'Working changes', base: base || 'Empty repository', head, files, limited: files.length + hidden < entries.length, notice: 'Read-only snapshot. Working folders may contain changes from several people or agents. Private paths and symlinks are excluded.', fingerprint: createHash('sha256').update(JSON.stringify({ root, mode, base, head, files })).digest('hex') };
}
