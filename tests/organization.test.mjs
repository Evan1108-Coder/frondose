import assert from "node:assert/strict";
import test from "node:test";
import { NAV_ITEMS, HEADER_QUICK_ACCESS, favoriteForPage, focusItems, focusedSidebarHiddenKeys, moveItem, normalizeOrganization, organizationCounts, readOrganization, resolveFavorite, saveOrganization, showSidebarItem } from "../src/lib/organization.js";
import { resolveShortcut, SHORTCUTS } from "../src/lib/shortcuts.js";
import { pageHash, parsePage } from "../src/lib/navigation.js";

test("organization preferences normalize hostile data, preserve ordering and add new defaults", () => {
  const prefs = normalizeOrganization({ version: 1, order: { primary: ["work", "work", "garbage"] }, visibility: { focus: "hidden", agents: "bogus" }, badges: "rainbow", density: "small", favorites: [{ view: "agents", id: "a" }, { view: "agents", id: "a" }, { view: "settings", id: "profile" }, { view: "chats", id: "../bad" }, null] });
  assert.deepEqual(prefs.order.primary, ["work", "overview", "rumbo-agent", "starred", "focus", "inbox", "updates", "workbench", "workflows", "operations"]);
  assert.equal(prefs.visibility.focus, "hidden"); assert.equal(prefs.visibility.agents, "always");
  assert.equal(prefs.badges, "count"); assert.equal(prefs.density, "comfortable");
  assert.deepEqual(prefs.favorites, [{ view: "agents", id: "a" }]);
  assert.deepEqual(normalizeOrganization({version: 2, favorites: [{view:"agents",id:"x"}]}).favorites, []);
});
test('retired Playbooks references disappear without losing unrelated navigation preferences', () => {
  const saved = { version: 1, order: { primary: ['workflows', 'playbooks', 'inbox'] },
    pinnedLayout: ['playbooks', 'projects'], quickAccess: ['focus', 'playbooks', 'settings'],
    visibility: { playbooks: 'hidden', workflows: 'hidden', 'custom:work': 'hidden' },
    favorites: [{ view: 'projects', id: 'p' }], hiddenItems: [{ view: 'chats', id: 'c' }],
    entityOrder: { projects: ['p', 'q'] }, seenFailures: ['failure'], navigationMode: 'full',
    layout: { root: ['playbooks', 'projects', 'custom:work'], groups: [{ id: 'custom:work', name: 'Mine', collapsed: true, items: ['playbooks', 'workflows', 'entity:projects:p'] }] } };
  const prefs = normalizeOrganization(saved);
  assert.ok(!NAV_ITEMS.some(item => item.id === 'playbooks'));
  assert.ok(!HEADER_QUICK_ACCESS.includes('playbooks'));
  assert.ok(!prefs.order.primary.includes('playbooks'));
  assert.equal(prefs.visibility.playbooks, undefined);
  assert.deepEqual(prefs.pinnedLayout, ['projects']);
  assert.deepEqual(prefs.quickAccess, ['focus', 'settings']);
  assert.ok(!prefs.layout.root.includes('playbooks'));
  assert.deepEqual(prefs.layout.groups, [{ id: 'custom:work', name: 'Mine', collapsed: true, items: ['workflows', 'entity:projects:p'] }]);
  assert.equal(prefs.visibility.workflows, 'hidden');
  assert.equal(prefs.visibility['custom:work'], 'hidden');
  assert.deepEqual(prefs.favorites, saved.favorites);
  assert.deepEqual(prefs.hiddenItems, saved.hiddenItems);
  assert.deepEqual(prefs.entityOrder.projects, ['p', 'q']);
  assert.deepEqual(prefs.seenFailures, ['failure']);
  assert.equal(prefs.navigationMode, 'full');
  assert.deepEqual(normalizeOrganization(prefs), prefs);
});
test("pinned placement and floating dock position remain browser-local and bounded", () => {
  const defaults = normalizeOrganization(null);
  assert.equal(defaults.showPinnedInHeader, true);
  assert.deepEqual(defaults.dockPosition, { x: 0.5, y: 0.9 });
  const prefs = normalizeOrganization({ ...defaults, showPinnedInHeader: false, dockPosition: { x: 5, y: -2 }, pinnedLayout: ['projects', 'projects', 'not-a-tab'] });
  assert.equal(prefs.showPinnedInHeader, false);
  assert.deepEqual(prefs.dockPosition, { x: 0.97, y: 0.05 });
  assert.deepEqual(prefs.pinnedLayout, ['projects']);
  assert.deepEqual(normalizeOrganization({ ...defaults, dockPosition: { x: 'bad', y: Infinity } }).dockPosition, defaults.dockPosition);
});
test("sidebar preferences are workspace-local, and storage failures are not silently reported saved", () => {
  const map = new Map(), storage = { getItem: k => map.get(k), setItem: (k,v) => map.set(k,v) };
  saveOrganization(storage, "one", { ...normalizeOrganization(null), shortcuts: false });
  assert.equal(readOrganization(storage, "one").shortcuts, false);
  assert.equal(readOrganization(storage, "two").shortcuts, true);
  assert.equal(readOrganization({getItem:()=>"invalid"}, "one").badges, "count");
  assert.throws(() => saveOrganization({setItem:()=>{throw Error("denied");}}, "one", null), /denied/);
});
test('focused navigation is the new default but preserves existing layouts and custom groups', () => {
  const fresh = normalizeOrganization(null);
  assert.equal(fresh.navigationMode, 'focused');
  const core = ['overview', 'rumbo-agent', 'starred', 'inbox', 'work', 'agents', 'teams', 'projects', 'tasks', 'chats', 'connections'];
  for (const key of core) assert.ok(!focusedSidebarHiddenKeys(fresh).includes(key), `${key} should be in the focused sidebar`);
  assert.ok(focusedSidebarHiddenKeys(fresh).includes('workflows'));
  assert.ok(focusedSidebarHiddenKeys(fresh).includes('memory'));
  const legacy = normalizeOrganization({ version: 1 });
  assert.equal(legacy.navigationMode, 'full');
  assert.deepEqual(focusedSidebarHiddenKeys(legacy), []);
  const custom = normalizeOrganization({ version: 1, navigationMode: 'focused', layout: { root: ['overview', 'rumbo-agent', 'custom:extra', 'focus'], groups: [{ id: 'custom:extra', name: 'Mine', items: ['skills'] }] } });
  assert.ok(!focusedSidebarHiddenKeys(custom).includes('custom:extra'));
  assert.ok(custom.layout.groups[0].items.includes('skills'));
  const hidden = normalizeOrganization({ version: 1, navigationMode: 'focused', visibility: { agents: 'hidden' } });
  assert.equal(showSidebarItem('agents', hidden, {}), false);
});
test("reordering is bounded and does not mutate previous state", () => {
  const input = ["a","b","c"];
  assert.deepEqual(moveItem(input,"a",1),["b","a","c"]);
  assert.deepEqual(moveItem(input,"a",-1),input); assert.deepEqual(moveItem(input,"missing",1),input);
  assert.deepEqual(input,["a","b","c"]);
});
const data = { projects: [{id:"p",name:"Project"},{id:"gone",archived_at:"now"}], teams: [], agents: [{id:"a",name:"Renamed agent"}], tasks: [{id:"blocked",title:"Blocked",status:"blocked",project_id:"p"},{id:"ready",title:"Ready",status:"ready"},{id:"hidden",title:"Hidden",status:"review",project_id:"gone"},{id:"done",title:"Done",status:"done"}], runs: [{id:"run",title:"Working",status:"needs_input"},{id:"failed",title:"Failure",status:"failed"},{id:"live",title:"Running",status:"running"},{id:"complete",title:"Complete",status:"completed"}], approvals: [{id:"one",run_id:"run",status:"pending"},{id:"stale",run_id:"complete",status:"pending"}], chats: [] };
test("favorites resolve live names and never expose archived or missing entities", () => {
  assert.equal(resolveFavorite(data,{view:"agents",id:"a"}).title,"Renamed agent");
  assert.equal(resolveFavorite(data,{view:"projects",id:"gone"}),null);
  assert.equal(resolveFavorite(data,{view:"settings",id:"profile"}),null);
  assert.equal(favoriteForPage(data,{view:"agents",id:"a"}).id,"a");
  assert.equal(favoriteForPage(data,{view:"agents",id:null}),null);
});
test("focus derives attention once per session and excludes completed/archived work", () => {
  const items=focusItems(data);
  assert.equal(items.filter(i=>i.id==="run").length,1);
  assert.equal(items.filter(i=>i.group==="attention").length,3);
  assert.equal(items.find(i=>i.id==="ready").group,"ready");
  assert.equal(items.find(i=>i.id==="live").group,"running");
  assert.ok(!items.some(i=>["hidden","done","complete"].includes(i.id)));
  const seen=focusItems(data,["failed"]);
  assert.ok(!seen.some(i=>i.id==="failed")); assert.ok(seen.some(i=>i.key==="approval:one"));
  assert.equal(data.runs.find(i=>i.id==="failed").status,"failed");
});
test("visibility follows actual counts regardless of badge presentation", () => {
  const prefs=normalizeOrganization({version:1,visibility:{focus:"activity",chats:"activity",agents:"hidden"},badges:"none"});
  const counts=organizationCounts(data,prefs);
  assert.equal(showSidebarItem("focus",prefs,counts),true);
  assert.equal(showSidebarItem("chats",prefs,counts),false);
  assert.equal(showSidebarItem("agents",prefs,counts),false);
  assert.equal(parsePage(pageHash("focus")).view,"focus");
});
test('Starred is a navigable, restorable destination and archived runs leave the list', () => {
  assert.equal(parsePage(pageHash('starred')).view, 'starred');
  const prefs = normalizeOrganization({ version: 1, favorites: [{ view: 'work', id: 'complete' }], visibility: { starred: 'hidden' } });
  assert.ok(prefs.layout.root.includes('starred'));
  assert.equal(showSidebarItem('starred', prefs, organizationCounts(data, prefs)), false);
  assert.equal(resolveFavorite(data, { view: 'work', id: 'complete' }).title, 'Complete');
  assert.equal(resolveFavorite({ ...data, runs: [{ ...data.runs.find(run => run.id === 'complete'), archived_at: 'now' }] }, { view: 'work', id: 'complete' }), null);
});
test("shortcut registry has unique actions and creates only dialogs, never approvals or launches", () => {
  assert.equal(new Set(SHORTCUTS.map(i=>i.id)).size,SHORTCUTS.length);
  assert.equal(resolveShortcut({key:"c"}).action,"create:task");
  assert.equal(resolveShortcut({key:"b",shiftKey:true}).action,"customize");
  const {prefix}=resolveShortcut({key:"n"},{now:100});
  assert.equal(resolveShortcut({key:"s"},{prefix,now:200}).action,"create:session");
  assert.equal(resolveShortcut({key:"f"},{prefix:{key:"g",at:100},now:200}).action,"go:focus");
  assert.equal(resolveShortcut({key:"p"},{prefix,now:1200}).action,undefined);
  assert.equal(resolveShortcut({key:"c"},{prefix:{key:"g",at:100},now:200}).action,"go:chats");
});
test("shortcuts protect typing, IME, modals, repeats and accessibility preferences", () => {
  for (const state of [{editing:true},{overlay:true},{enabled:false}]) assert.equal(resolveShortcut({key:"c"},state).action,undefined);
  for (const event of [{key:"c",isComposing:true},{key:"c",repeat:true},{key:"c",altKey:true},{key:"c",defaultPrevented:true},{key:"c",metaKey:true}]) assert.equal(resolveShortcut(event).action,undefined);
  assert.equal(resolveShortcut({key:"k",metaKey:true},{enabled:false,editing:true}).action,"search");
  assert.equal(resolveShortcut({key:"k",ctrlKey:true},{overlay:true}).action,undefined);
  assert.equal(resolveShortcut({key:"k",ctrlKey:true},{overlay:true,paletteOpen:true}).action,"search");
  assert.equal(resolveShortcut({key:"x"},{prefix:{key:"n",at:100},now:200}).consumed,true);
});
