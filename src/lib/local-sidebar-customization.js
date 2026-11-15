import { focusedSidebarHiddenKeys, normalizeOrganization } from './organization.js';
import { LOCAL_PRIMARY_NAV, LOCAL_SIDEBAR_PAGES } from './local-navigation.js';

/** Reflect the sidebar users actually see, rather than showing "Show" for a
 * page the legacy focused-mode filter still silently hides. Old preferences
 * remain intact until the owner explicitly saves the editor. */
export function localSidebarEditorDraft(value) {
  const draft = normalizeOrganization(value);
  if (draft.localSidebarCustomized || draft.navigationMode !== 'focused') return draft;
  const hidden = new Set(focusedSidebarHiddenKeys(draft));
  const visibility = { ...draft.visibility };
  for (const item of LOCAL_SIDEBAR_PAGES) if (hidden.has(item.id)) visibility[item.id] = 'hidden';
  return { ...draft, visibility };
}

export function savedLocalSidebarDraft(draft) {
  const visibility = { ...draft.visibility };
  for (const item of LOCAL_PRIMARY_NAV) visibility[item.id] = 'always';
  return normalizeOrganization({ ...draft, visibility, localSidebarCustomized: true });
}
