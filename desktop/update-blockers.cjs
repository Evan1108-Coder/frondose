'use strict';

const rendererKinds = ['file-draft', 'file-save', 'form-draft', 'update-draft', 'dialog', 'editor', 'workspace-save', 'draft-check'];
const kinds = new Set([...rendererKinds, 'terminal', 'terminal-starting', 'terminal-stopping', 'terminal-uncertain', 'agent-run', 'agent-chat', 'environment', 'active-work', 'browser-page', 'other-window', 'pending-write', 'window-loading', 'window-unresponsive', 'separate-server']);
const label = value => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 160) : '';

// Diagnostic text never grants permission to install, kill or close anything.
function cleanBlockers(input, allowed = kinds) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 48).flatMap(row => {
    if (!allowed.has(row?.kind)) return [];
    return [{ kind: row.kind, label: label(row.label), workspace: label(row.workspace), project: label(row.project), count: Number.isSafeInteger(row.count) && row.count > 0 ? Math.min(row.count, 100000) : 1 }];
  });
}
function leaseBlockers(lease) {
  const rows = cleanBlockers(lease.work);
  const remainder = Number(lease.activeWork) - rows.reduce((sum, row) => sum + row.count, 0);
  if (remainder > 0) rows.push({ kind: 'active-work', count: remainder });
  if (lease.otherWindows > 0) rows.push({ kind: 'other-window', count: lease.otherWindows });
  if (lease.pendingWrites > 0) rows.push({ kind: 'pending-write', count: lease.pendingWrites });
  return rows;
}
function blocked(rows) {
  return Object.assign(Error('Finish the items below, then try the update again.'), { blockers: cleanBlockers(rows) });
}
module.exports = { blocked, cleanBlockers, leaseBlockers, rendererKinds: new Set(rendererKinds) };
