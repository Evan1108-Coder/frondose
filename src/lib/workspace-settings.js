import { pageHash, parsePage } from './navigation.js';
import { workspaceTabStorageKey } from './workspace-tabs.js';
import { isWorkspaceStandalonePage } from './workspace-screens.js';

const RETURN_PREFIX = 'frondose.workspace-settings-return.v1:';
const MAX_ROUTE_LENGTH = 4096;
const MAX_SAVED_TABS_LENGTH = 256_000;
const validWorkspaceId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
const legacyViews = { teams: 'areas', today: 'overview', conversations: 'chats', knowledge: 'library', runs: 'work', 'rumbo-agent': 'frondose-agent', 'talvori-agent': 'frondose-agent' };

function canonicalReturnHash(value) {
  if (typeof value !== 'string' || value.length > MAX_ROUTE_LENGTH || !value.startsWith('#/') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const page = parsePage(value);
  if (isWorkspaceStandalonePage(page)) return null;
  const canonical = pageHash(page.view, page.id, page);
  // parsePage deliberately repairs invalid locations to Today. Do not let a
  // corrupt remembered route mask a still-valid saved workspace destination.
  const normalized = value.replace(/^#\/([^/?]+)/, (match, view) => legacyViews[view] ? `#/${legacyViews[view]}` : match);
  return canonical.length <= MAX_ROUTE_LENGTH && normalized === canonical ? canonical : null;
}

function pageReturnHash(page) {
  if (!page || typeof page !== 'object' || Array.isArray(page) || typeof page.view !== 'string') return null;
  try {
    const hash = pageHash(page.view, page.id ?? null, page);
    // Unknown views are normalized by the general builder, but are not a
    // deliberate return destination and must not overwrite a valid preference.
    if (pageHash(page.view) === '#/overview' && !['overview', 'today'].includes(page.view)) return null;
    return canonicalReturnHash(hash);
  } catch { return null; }
}

function readBounded(storage, key, maximum) {
  try {
    const value = storage.getItem(key);
    return typeof value === 'string' && value.length <= maximum ? value : null;
  } catch { return null; }
}

/** Remember navigation only. Settings, commands, drafts and execution state
 * never become a return location or enter this browser-local preference. */
export function rememberWorkspaceReturnPage(storage, workspaceId, page) {
  if (!validWorkspaceId(workspaceId)) return false;
  const hash = pageReturnHash(page);
  if (!hash) return false;
  try { storage.setItem(RETURN_PREFIX + workspaceId, hash); return true; }
  catch { return false; }
}

/** Resolve a safe app page without reading or altering tab/session identities. */
export function workspaceSettingsReturnPage(storage, workspaceId) {
  if (!validWorkspaceId(workspaceId)) return parsePage('#/overview');
  const remembered = canonicalReturnHash(readBounded(storage, RETURN_PREFIX + workspaceId, MAX_ROUTE_LENGTH));
  if (remembered) return parsePage(remembered);
  const rawTabs = readBounded(storage, workspaceTabStorageKey(workspaceId), MAX_SAVED_TABS_LENGTH);
  if (rawTabs) {
    try {
      const saved = JSON.parse(rawTabs);
      const hash = saved?.version === 1 && Array.isArray(saved.tabs) ? canonicalReturnHash(saved.lastPageHash) : null;
      if (hash) return parsePage(hash);
    } catch { /* A corrupt or unavailable layout is not a return destination. */ }
  }
  return parsePage('#/overview');
}
