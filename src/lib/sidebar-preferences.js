const SECTIONS = ["teams", "projects", "workspace", "chats", "favorites", "agents", "views"];

export function normalizeSidebarPreferences(value) {
  const sections = Object.fromEntries(SECTIONS.map((key) => [key, value?.sections?.[key] !== false]));
  const projects = {};
  if (value?.version === 1 && value.projects && typeof value.projects === "object") {
    for (const [key, expanded] of Object.entries(value.projects)) {
      if (key !== "__proto__" && key !== "constructor" && typeof expanded === "boolean") projects[key] = expanded;
    }
  }
  const teams = {};
  if (value?.version === 1 && value.teams && typeof value.teams === 'object') {
    for (const [key, expanded] of Object.entries(value.teams)) {
      if (key !== '__proto__' && key !== 'constructor' && typeof expanded === 'boolean') teams[key] = expanded;
    }
  }
  return { version: 1, sections, projects, teams };
}

export function readSidebarPreferences(storage, workspaceId) {
  try {
    return normalizeSidebarPreferences(JSON.parse(storage.getItem(`rumbo.navigation.v1.${workspaceId}`)));
  } catch {
    return normalizeSidebarPreferences(null);
  }
}

export function saveSidebarPreferences(storage, workspaceId, value) {
  try {
    storage.setItem(`rumbo.navigation.v1.${workspaceId}`, JSON.stringify(normalizeSidebarPreferences(value)));
  } catch { /* Navigation remains usable when browser storage is unavailable. */ }
}
