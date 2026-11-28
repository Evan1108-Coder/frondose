/** Every entry must link to an authored in-app Docs article. Newest first. */
export const PRODUCT_UPDATES = Object.freeze([
  Object.freeze({id:'work-plan-and-first-run',title:'Work Plan and a smoother first run',date:'2026-11-23',articleId:'work-plan-and-first-run'}),
  Object.freeze({id:'dated-support-logs',title:'Copy a day of support logs',date:'2026-11-22',articleId:'dated-support-logs'}),
  Object.freeze({id:'organized-frond-menu',title:'More controls in the frond menu',date:'2026-11-21',articleId:'organized-frond-menu',appVersion:'0.1.18'}),
  Object.freeze({id:'native-desktop-presence',title:'Frondose in the menu bar and system tray',date:'2026-11-21',articleId:'native-desktop-presence',appVersion:'0.1.17'}),
  Object.freeze({id:'release-candidate-fixes',title:'Browser, Chat and workspace reliability fixes',date:'2026-11-15',articleId:'release-candidate-fixes',appVersion:'0.1.16'}),
  Object.freeze({id:'review-update-cleanup',title:'Review and close update blockers',date:'2026-11-15',articleId:'review-update-cleanup',appVersion:'0.1.15'}),
  Object.freeze({id:'clearer-update-blockers',title:'See what is blocking an update',date:'2026-11-15',articleId:'clearer-update-blockers',appVersion:'0.1.14'}),
  Object.freeze({id:'language-and-workspace-controls',title:'More translated screens and workspace controls',date:'2026-11-15',articleId:'language-and-workspace-controls',appVersion:'0.1.13'}),
  Object.freeze({id:'delete-to-dos',title:'Delete active or finished to-dos',date:'2026-11-14',articleId:'delete-to-dos',appVersion:'0.1.12'}),
  Object.freeze({id:'area-creation-navigation',title:'Open an Area right after creating it',date:'2026-11-14',articleId:'area-creation-navigation',appVersion:'0.1.11'}),
  Object.freeze({id:'desktop-release-hardening',title:'Workspace activity and desktop reliability',date:'2026-11-14',articleId:'desktop-release-hardening',appVersion:'0.1.10'}),
  Object.freeze({id:'saved-passwords-more-chat-agents',title:'Saved passwords, more Chat agents & Codex usage',date:'2026-11-14',articleId:'saved-passwords-more-chat-agents',appVersion:'0.1.9'}),
  Object.freeze({id:'browser-import-agent-modes',title:'Browser import and AI session modes',date:'2026-11-14',articleId:'browser-import-agent-modes',appVersion:'0.1.8'}),
  Object.freeze({id:'version-specific-release-review',title:'Release notes for every build',date:'2026-11-14',articleId:'version-specific-release-review',appVersion:'0.1.7'}),
  Object.freeze({id:'centered-update-progress',title:'A simpler update screen',date:'2026-11-13',articleId:'centered-update-progress',appVersion:'0.1.6'}),
  Object.freeze({id:'right-corner-update-notices',title:'Update notices on the right',date:'2026-11-12',articleId:'right-corner-update-notices',appVersion:'0.1.5'}),
  Object.freeze({id:'local-mac-build-updates',title:'Install local Mac builds in Frondose',date:'2026-11-12',articleId:'local-mac-build-updates',appVersion:'0.1.4'}),
  Object.freeze({id:'native-tools-rich-previews',title:'Native tools, AI sessions & rich previews',date:'2026-11-11',articleId:'native-tools-rich-previews',appVersion:'0.1.3'}),
  Object.freeze({"id":"editor-checklists-direct-drops","title":"Rich writing, checklists & direct drops","date":"2026-11-07","articleId":"editor-checklists-direct-drops","appVersion":"0.1.2"}),
  Object.freeze({"id":"resources-and-area-updates","title":"Linked resources & Area updates","date":"2026-11-06","articleId":"resources-and-area-updates"}),
  Object.freeze({"id":"shared-area-task-status","title":"Shared tasks, independent status","date":"2026-11-03","articleId":"shared-area-task-status"}),
  Object.freeze({"id":"task-board-block-writing","title":"To Do List & block writing","date":"2026-11-02","articleId":"task-board-block-writing"}),
  Object.freeze({"id":"browser-setup-local-polish","title":"Browser, CLI setup & workspace polish","date":"2026-11-01","articleId":"browser-setup-local-polish"}),
  Object.freeze({"id":"workspace-navigation-refinements","title":"Workspace navigation refinements","date":"2026-10-31","articleId":"workspace-navigation-refinements"}),
  Object.freeze({id:'project-reviews-automations',title:'Projects, review notes & automations',date:'2026-10-30',articleId:'project-reviews-automations',appVersion:'0.1.1'}),
  Object.freeze({ id: 'local-cli-workspace', title: 'Your local workspace', date: '2026-10-26', articleId: 'local-cli-workspace', appVersion: '0.1.0' }),
  Object.freeze({ id: 'your-agents-library', title: 'Your Agents, connected', date: '2026-10-24', articleId: 'your-agents-library', cover: '/agent-connections/codex-feature.png', coverAlt: 'Illustrated Codex connection preview in Frondose', coverCaption: 'Product illustration · not live account data' }),
  Object.freeze({ id: 'initial-launch', title: 'Initial Launch', date: '2026-10-19', articleId: 'initial-launch' }),
]);
export function productUpdateForVersion(version, updates = PRODUCT_UPDATES) {
  return version ? updates.find(update => update.appVersion === version) : undefined;
}
export function productUpdateForTab(id) {
  return PRODUCT_UPDATES.find(update => update.id === id) ?? productUpdateForVersion(id?.startsWith('installed-') ? id.slice('installed-'.length) : null);
}
export function publishedProductUpdates(updates = PRODUCT_UPDATES, now = new Date()) {
  const today = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString().slice(0, 10) : '';
  return updates.filter(update => typeof update?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(update.date) &&
    Number.isFinite(Date.parse(`${update.date}T00:00:00Z`)) && new Date(`${update.date}T00:00:00Z`).toISOString().slice(0, 10) === update.date && update.date <= today)
    .slice().sort((a, b) => b.date.localeCompare(a.date));
}
export function recentProductUpdates(updates = PRODUCT_UPDATES, now = new Date()) {
  return publishedProductUpdates(updates, now).slice(0, 3);
}
