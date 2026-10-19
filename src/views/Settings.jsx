import { useRef, useState } from "react";
import { ImageField } from '../components/ImageField.jsx';
import { Form } from "../components/Form.jsx";
import { CircleUser, Paintbrush, Bell, Users, Database, Archive, Activity, Download, RotateCcw, Pencil, Folder, Keyboard, ShieldCheck, X, Check } from "../components/icons.jsx";
import { talvoriApi } from "../data/api.js";
import { talvoriActions } from "../data/useTalvori.js";
import {
  Button,
  Empty,
  ErrorMessage,
  Field,
  PageHeader,
  Select,
  Toggle,
  useApp,
  useAsync,
} from "../ui.jsx";
import { download, initials, val } from "../lib/model.js";
import { resolveFavorite } from '../lib/organization.js';

const SECTIONS = [
  { id: "profile", label: "Profile", icon: CircleUser },
  { id: "workspace", label: "Workspace", icon: Users },
  { id: "appearance", label: "Appearance", icon: Paintbrush },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "storage", label: "Data & export", icon: Database },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
];
export function SettingsView() {
  const {
    data,
    page,
    navigate,
    workspace,
    edit,
    perform,
    notify,
    status,
    showShortcuts,
    customizeSidebar,
  } = useApp();
  const section = SECTIONS.some((item) => item.id === page.id)
    ? page.id
    : "profile";
  const settings = data.settings ?? {},
    appearance = settings.appearance ?? {},
    notifications = settings.notifications ?? {};
  const update = (group, value) =>
    perform(
      () => talvoriActions.updateSettings({ [group]: value }),
      "Preference saved",
    );
  return (
    <main className="page settings-page">
      <PageHeader
        title="Settings"
        description="Make this workspace feel like yours."
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              onClick={() => navigate("settings", id)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <section className="settings-content" key={section}>
          {section === "profile" ? <Profile /> : null}
          {section === "workspace" ? (
            <>
              <SectionTitle
                title="Workspace"
                description="Projects and conversations are kept separate in each workspace."
              />
              <div className="workspace-summary">
                <span className="workspace-large-icon">
                  {initials(workspace.name)}
                </span>
                <div>
                  <h3>{workspace.name}</h3>
                  <p>{workspace.description || "Your workspace"}</p>
                </div>
                <Button
                  icon={Pencil}
                  onClick={() => edit("workspace", workspace)}
                >
                  Edit
                </Button>
              </div>
              <div className="setting-row">
                <span>
                  <strong>New workspace</strong>
                  <small>
                    Create a separate space for another Area or project group.
                  </small>
                </span>
                <Button onClick={() => edit("workspace")}>
                  Create workspace
                </Button>
              </div>
              <div className="setting-row">
                <span>
                  <strong>Simultaneous agent sessions</strong>
                  <small>
                    Limit how many sessions can run at the same time.
                  </small>
                </span>
                <Select
                  value={settings.agentDefaults?.concurrentRuns ?? 2}
                  onChange={(value) =>
                    update("agentDefaults", { concurrentRuns: Number(value) })
                  }
                  aria-label="Simultaneous sessions"
                >
                  {[1, 2, 3, 4, 6, 8].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="setting-row">
                <span>
                  <strong>Default agent permissions</strong>
                  <small>
                    Read only prevents live sessions from enabling project
                    edits.
                  </small>
                </span>
                <Select
                  value={settings.agentDefaults?.approvalMode ?? "ask"}
                  onChange={(value) =>
                    update("agentDefaults", { approvalMode: value })
                  }
                  aria-label="Default agent permissions"
                >
                  <option value="ask">Choose per session</option>
                  <option value="read_only">Read only</option>
                </Select>
              </div>
            </>
          ) : null}
          {section === "appearance" ? (
            <>
              <SectionTitle
                title="Appearance"
                description="A comfortable place to focus, in any light."
              />
              <div className="theme-options">
                {["dark", "light", "system"].map((theme) => (
                  <button
                    key={theme}
                    className={appearance.theme === theme ? "active" : ""}
                    onClick={() => update("appearance", { theme })}
                  >
                    <span className={`theme-preview theme-${theme}`}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      {theme[0].toUpperCase() + theme.slice(1)}
                      {appearance.theme === theme ? <Check /> : null}
                    </span>
                  </button>
                ))}
              </div>
              <div className="setting-row">
                <span>
                  <strong>Display density</strong>
                  <small>Adjust the space between items in lists.</small>
                </span>
                <Select
                  value={appearance.density ?? "comfortable"}
                  onChange={(value) => update("appearance", { density: value })}
                  aria-label="Display density"
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </Select>
              </div>
              <Toggle
                label="Reduce motion"
                description="Remove interface transitions."
                checked={appearance.reduceMotion}
                onChange={(value) =>
                  update("appearance", { reduceMotion: value })
                }
              />
              <div className="setting-row">
                <span>
                  <strong>Keyboard shortcuts</strong>
                  <small>Move around Talvori without leaving the keyboard.</small>
                </span>
                <Button icon={Keyboard} onClick={showShortcuts}>
                  View shortcuts
                </Button>
              </div>
              <div className="setting-row"><span><strong>Sidebar layout</strong><small>Choose what appears, reorder sections, and set badge styles for this workspace.</small></span><Button onClick={customizeSidebar}>Customize sidebar</Button></div>
            </>
          ) : null}
          {section === "notifications" ? (
            <>
              <SectionTitle
                title="Notifications"
                description="Choose which session updates appear in your inbox."
              />
              <Toggle
                label="Completed sessions"
                description="Show an inbox update when an agent finishes."
                checked={notifications.runCompleted !== false}
                onChange={(value) =>
                  update("notifications", { runCompleted: value })
                }
              />
              <Toggle
                label="Failed sessions"
                description="Show an inbox update when something goes wrong."
                checked={notifications.runFailed !== false}
                onChange={(value) =>
                  update("notifications", { runFailed: value })
                }
              />
              <div className="setting-explanation">
                <ShieldCheck />
                <p>
                  Pending permission requests always remain visible in Inbox and
                  Live work until you respond.
                </p>
              </div>
            </>
          ) : null}
          {section === "storage" ? (
            <>
              <SectionTitle
                title="Data & export"
                description="Export your workspace content. Provider credentials are never included."
              />
              <div className="setting-row">
                <span>
                  <strong>Export this workspace</strong>
                  <small>
                    Projects, routes, chats, messages, agents, memory, and
                    session history as JSON.
                  </small>
                </span>
                <Button
                  icon={Download}
                  onClick={() =>
                    perform(async () => {
                      const response = await talvoriApi.exportWorkspace(
                        workspace.id,
                      );
                      download(
                        `talvori-${workspace.slug ?? workspace.name}-export.json`,
                        response.result,
                      );
                      notify("Workspace exported");
                    })
                  }
                >
                  Export JSON
                </Button>
              </div>
              <div className="setting-row">
                <span>
                  <strong>Archived items</strong>
                  <small>
                    Restore projects, routes, chats, agents, and memory notes.
                  </small>
                </span>
                <Button
                  icon={Archive}
                  onClick={() => navigate("settings", "archive")}
                >
                  Open archive
                </Button>
              </div>
              <div className="setting-explanation">
                <Database />
                <p>
                  Keep a private backup of the server’s data directory to preserve
                  the full installation. New installations use <code>.talvori</code>;
                  upgraded installations retain their existing data location.
                  Workspace JSON exports do not include account credentials.
                </p>
              </div>
            </>
          ) : null}
          {section === "archive" ? <ArchiveList /> : null}
          {section === "diagnostics" ? (
            <>
              <SectionTitle
                title="Diagnostics"
                description="Workspace status, without credentials or account secrets."
              />
              <dl className="diagnostic-list">
                {[
                  [
                    "Data source",
                    status.source === "server"
                      ? "Workspace server"
                      : "Unavailable",
                  ],
                  [
                    "Last synced",
                    status.lastUpdatedAt
                      ? new Date(status.lastUpdatedAt).toLocaleString()
                      : "Not yet",
                  ],
                  ["Projects", data.projects.length],
                  ["Routes", data.tasks.length],
                  ["Conversations", data.chats.length],
                  ["Sessions", data.runs.length],
                  ["Saved memory", data.memory_notes.length],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <ErrorMessage error={status.syncError || status.error} />
              <div className="settings-actions">
                <Button
                  busy={status.refreshing}
                  icon={RotateCcw}
                  onClick={() =>
                    perform(() => talvoriActions.refresh(), "Workspace refreshed")
                  }
                >
                  Refresh workspace data
                </Button>
                <Button
                  icon={Download}
                  onClick={() => {
                    download("talvori-diagnostics.json", {
                      generatedAt: new Date().toISOString(),
                      meta: data.meta,
                      counts: {
                        projects: data.projects.length,
                        routes: data.tasks.length,
                        chats: data.chats.length,
                        sessions: data.runs.length,
                      },
                      connectionStates: data.connections.map((item) => ({
                        provider: item.provider,
                        state: item.state,
                      })),
                    });
                    notify("Diagnostics exported");
                  }}
                >
                  Export diagnostics
                </Button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
function SectionTitle({ title, description }) {
  return (
    <div className="settings-section-title">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
export function Profile() {
  const { data, notify, navigate, organization, toggleFavorite } = useApp();
  const [name, setName] = useState(data.profile?.name ?? ""),
    [email, setEmail] = useState(data.profile?.email ?? ""),
    [avatar, setAvatar] = useState(data.profile?.avatar_url ?? null);
  const { busy, error, execute } = useAsync();
  return (
    <>
      <SectionTitle
        title="Your profile"
        description="Your name and picture, shown with your work."
      />
      <Form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          execute(async () => {
            await talvoriActions.updateProfile({
              name: name.trim(),
              email: email.trim() || null,
              avatar_url: avatar,
            });
            notify("Profile saved");
          });
        }}
      >
        <ImageField label="Profile photo" value={avatar} onChange={setAvatar} disabled={busy} />
        <Field label="Display name">
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Email"
          hint="Optional contact detail. No emails are sent."
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <ErrorMessage error={error} />
        <div className="form-submit-row">
          <Button
            variant="primary"
            type="submit"
            busy={busy}
            disabled={!name.trim()}
          >
            Save profile
          </Button>
        </div>
      </Form>
      <div className="setting-row"><span><strong>Starred items</strong><small>{organization.favorites.length} personal shortcuts in this workspace.</small></span><Button onClick={() => navigate('starred')}>Open Starred</Button></div>
      <div className="starred-list">{organization.favorites.map(reference => resolveFavorite(data, reference)).filter(Boolean).map(item => <div className="starred-row" key={`${item.view}:${item.id}`}><button onClick={() => navigate(item.view, item.id)}><strong>{item.title}</strong><small>{item.view === 'work' ? 'Run' : item.view}</small></button><Button onClick={() => toggleFavorite(item)}>Unstar</Button></div>)}</div>
    </>
  );
}
export function ArchiveList() {
  const { data, perform, notify } = useApp();
  const items = [
    ["projects", "Project", "updateProject"],
    ["tasks", "Route", "updateTask"],
    ["chats", "Chat", "updateChat"],
    ["agents", "Agent", "updateAgent"],
    ["memory_notes", "Memory", "updateMemoryNote"],
    ["teams", "Area", "updateTeam"],
    ["team_members", "Person", "updateTeamMember"],
    ["documents", "Document", "updateDocument"],
    ["milestones", "Milestone", "updateMilestone"],
  ].flatMap(([collection, label, action]) =>
    (data[collection] ?? [])
      .filter((item) => val(item, "archived_at"))
      .map((item) => ({ ...item, label, action })),
  );
  return (
    <>
      <SectionTitle
        title="Archive"
        description="Archived items stay here until you need them again."
      />
      {items.length ? (
        items.map((item) => (
          <div className="archive-row" key={item.id}>
            <Archive />
            <span>
              <strong>{item.name ?? item.title}</strong>
              <small>{item.label}</small>
            </span>
            <Button
              icon={RotateCcw}
              onClick={() =>
                perform(async () => {
                  await talvoriActions[item.action](item.id, {
                    archived_at: null,
                  });
                  notify(`${item.label} restored`);
                })
              }
            >
              Restore
            </Button>
          </div>
        ))
      ) : (
        <Empty
          compact
          kind="archive"
          icon={Archive}
          title="Your archive is empty"
          description="Items you archive will appear here and can be restored at any time."
        />
      )}
    </>
  );
}
