// One active workspace host; navigation guards are callbacks, never portable authority.
let navigator;
export function registerWorkspaceNavigator(handler) {
  navigator = handler;
  return () => { if (navigator === handler) navigator = undefined; };
}
export function requestWorkspaceNavigation(target, commit) {
  if (navigator) return navigator(target, commit);
  return commit();
}
