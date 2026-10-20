import { useEffect, useState } from "react";
import { Form } from "../components/Form.jsx";
import { ExternalLink, ArrowRight, Plug, CircleCheck, Copy, Folder, Search, RotateCcw, Link, ShieldCheck, X } from "../components/icons.jsx";
import { frondoseApi } from "../data/api.js";
import { frondoseActions } from "../data/useFrondose.js";
import {
  Button,
  Dialog,
  Empty,
  ErrorMessage,
  Field,
  PageHeader,
  ProviderIcon,
  SearchField,
  Status,
  useApp,
  useAsync,
} from "../ui.jsx";
import { safeUrl } from "../lib/model.js";
import {
  CONNECTION_PROVIDERS,
  connectionSettingsTabs,
  defaultConnectionSettings,
  effectiveConnectionCommands,
} from "../lib/connection-settings.js";

const CONNECTION_TAB_LABELS = {
  overview: "Overview",
  resources: "Resources",
  mappings: "Mappings",
  rules: "Rules",
  agents: "Agent access",
  context: "Context",
  commands: "Commands",
  notifications: "Notifications",
  security: "Security",
  activity: "Activity",
};

export function ConnectionsView() {
  const { data } = useApp();
  const [setups, setSetups] = useState([]),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    frondoseApi
      .connectionSetups()
      .then((response) => {
        if (active) setSetups(response.result.setups ?? []);
      })
      .catch((error) => {
        if (active) setError(error);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="page">
      <PageHeader
        title="Connections"
        description="Bring your agents, repositories, and files into the same workspace."
      />
      <ErrorMessage error={error} />
      <div className="connections-group">
        <h2>AI workers</h2>
        <p className="muted">
          Connect your own accounts. You choose when an agent starts working.
        </p>
        <div className="connection-grid">
          {data.connections
            .filter((item) => ["codex", "claude"].includes(item.provider))
            .map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                setup={setups.find(
                  (item) => item.provider === connection.provider,
                )}
                onOpen={() => setSelected(connection.provider)}
              />
            ))}
        </div>
      </div>
      <div className="connections-group">
        <h2>Project context</h2>
        <p className="muted">
          External service connections are coming soon. Existing records are preserved,
          but authorization and synchronization are paused.
        </p>
        <div className="connection-grid">
          {data.connections
            .filter((item) => !["codex", "claude"].includes(item.provider))
            .map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                setup={setups.find(
                  (item) => item.provider === connection.provider,
                )}
                onOpen={() => setSelected(connection.provider)}
              />
            ))}
        </div>
      </div>
      <div className="connections-group">
        <h2>Extension previews</h2>
        <p className="muted">
          Review planned settings and commands. These entries do not authorize
          an account or enable an external API.
        </p>
        <div className="connection-grid">
          {Object.values(CONNECTION_PROVIDERS)
            .filter((item) => item.implementation === "metadata_only")
            .map((descriptor) => (
              <ConnectionCard
                key={descriptor.id}
                connection={{
                  provider: descriptor.id,
                  state: "preview",
                  description: descriptor.boundary,
                }}
                descriptor={descriptor}
                onOpen={() => setSelected(descriptor.id)}
              />
            ))}
        </div>
      </div>
      <div className="page-footnote">
        <ShieldCheck />
        <p>
          Opening this page does not
          sign in, inspect an account, or start a paid request.
        </p>
      </div>
      {selected ? (
        <ConnectionDialog
          provider={selected}
          setup={setups.find((item) => item.provider === selected)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </main>
  );
}
function ConnectionCard({ connection, setup, descriptor, onOpen }) {
  const name =
    setup?.displayName ?? descriptor?.displayName ?? connection.display_name ?? connection.displayName;
  const preview = connection.state === "preview";
  const comingSoon = !["codex", "claude"].includes(connection.provider);
  return (
    <article className="connection-card">
      <div className="connection-card-top">
        <ProviderIcon provider={connection.provider} large />
        <span
          className={`connection-state ${connection.state === "connected" ? "connected" : ""}`}
        >
          <i />
          {comingSoon
            ? "Coming soon"
            : connection.state === "connected"
            ? "Connected"
            : connection.state === "connecting"
              ? "Connecting"
              : preview
                ? "Preview"
                : "Not connected"}
        </span>
      </div>
      <h3>{name}</h3>
      <p>{setup?.purpose ?? descriptor?.boundary ?? connection.description}</p>
      <div className="connection-card-footer">
        <span>
          {comingSoon
            ? "Unavailable for now"
            : preview
            ? "Configuration only"
            : connection.provider === "google-drive"
            ? "Read-only metadata"
            : connection.provider === "claude"
              ? "Read & search"
              : connection.provider === "codex"
                ? "Analysis & coding"
                : "Repositories"}
        </span>
        <Button onClick={onOpen}>
          {comingSoon ? "View preview" : connection.state === "connected" ? "Manage" : preview ? "View details" : "Set up"}
          <ArrowRight />
        </Button>
      </div>
    </article>
  );
}
export function ConnectionDialog(props) {
  const { workspace } = useApp();
  return <WorkspaceConnectionDialog key={workspace.id} {...props} />;
}

function WorkspaceConnectionDialog({ provider, setup: initialSetup, onClose }) {
  const { data, perform, notify, edit, workspace } = useApp();
  const descriptor = CONNECTION_PROVIDERS[provider];
  const comingSoon = !["codex", "claude"].includes(provider);
  const metadataOnly = comingSoon || descriptor?.implementation === "metadata_only";
  const [setup, setSetup] = useState(initialSetup),
    [current, setCurrent] = useState(null),
    [token, setToken] = useState(""),
    [showToken, setShowToken] = useState(false),
    [message, setMessage] = useState(""),
    [authUrl, setAuthUrl] = useState(null),
    [resources, setResources] = useState(null),
    [nextPage, setNextPage] = useState(null),
    [query, setQuery] = useState(""),
    [activeTab, setActiveTab] = useState("overview"),
    [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { busy, error, execute, setError } = useAsync();
  const savedConnection = data.connections.find((item) => item.provider === provider);
  const connection = current ?? (savedConnection?.workspace_states ? { ...savedConnection, state: savedConnection.workspace_states[workspace.id] || 'not_connected' } : savedConnection);
  const connected = connection?.state === "connected";
  useEffect(() => {
    if (metadataOnly) return undefined;
    setCurrent(null); setAuthUrl(null); setMessage('');
    let active = true;
    Promise.all([
      frondoseApi.connectionSetup(provider),
      frondoseApi.connectionStatus(provider, { workspaceId: workspace.id }),
    ])
      .then(([s, c]) => {
        if (active) {
          setSetup(s.result.setup);
          setCurrent(c.result.connection);
        }
      })
      .catch((cause) => {
        if (active) setError(cause);
      });
    return () => {
      active = false;
    };
  }, [provider, metadataOnly, workspace.id]);
  const reloadSetup = () =>
    execute(async () => {
      const [s, c] = await Promise.all([
        frondoseApi.connectionSetup(provider),
        frondoseApi.connectionStatus(provider, { workspaceId: workspace.id }),
      ]);
      setSetup(s.result.setup);
      setCurrent(c.result.connection);
    });
  useEffect(() => {
    if (
      !["connecting", "authenticating", "authorizing"].includes(
        connection?.state,
      ) &&
      !authUrl
    )
      return;
    let active = true;
    const timer = setInterval(() => {
      frondoseApi
        .connectionStatus(provider, { workspaceId: workspace.id })
        .then((response) => {
          if (!active) return;
          setCurrent(response.result.connection);
          if (response.result.connection?.state === "connected") {
            setAuthUrl(null);
            setMessage("Connected successfully.");
            frondoseActions.refresh({ quiet: true }).catch(() => {});
          }
        })
        .catch(() => {});
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [provider, connection?.state, authUrl, workspace.id]);
  const connect = (method) =>
    execute(async () => {
      const result = await frondoseActions.connectConnection(provider, {
        method,
        workspace_id: workspace.id,
        ...(method === "token" ? { token } : {}),
      });
      setToken("");
      setCurrent(result.connection);
      setMessage(result.message ?? "Connection updated");
      const url = safeUrl(result.authorizationUrl);
      setAuthUrl(url);
    });
  const check = () =>
    execute(async () => {
      const result = await frondoseActions.checkConnection(provider, { workspaceId: workspace.id });
      setCurrent(result.connection);
      setMessage(
        result.message ??
          (result.connection?.state === "connected"
            ? "Connection verified."
            : "Not signed in yet. Complete sign-in and check again."),
      );
    });
  const browse = (more = false) =>
    execute(async () => {
      const response = await frondoseApi.connectionResources(
        provider,
        more && nextPage ? { pageToken: nextPage } : {},
      );
      setResources((current) =>
        more
          ? [...(current ?? []), ...(response.result.resources ?? [])]
          : (response.result.resources ?? []),
      );
      setNextPage(response.result.nextPageToken ?? null);
    });
  const authOutput =
    connection?.auth?.output ?? connection?.metadata?.auth?.output;
  const tabs = connectionSettingsTabs(provider, {
    connectionState: connection?.state ?? "not_connected",
  });
  if (comingSoon) return <Dialog title={setup?.displayName ?? descriptor?.displayName ?? provider} subtitle="Coming soon" onClose={onClose} wide><div className="connection-setup"><div className="connection-detail-state"><ProviderIcon large provider={provider} /><span className="connection-preview-badge">Coming soon</span></div><div className="connection-boundary is-preview"><strong>External service connection paused</strong><p>Frondose is focusing on AI-agent connections. Authorization, resource sync, and provider actions are unavailable for now. Existing records are preserved.</p></div></div></Dialog>;
  return (
    <Dialog
      title={setup?.displayName ?? descriptor?.displayName ?? provider}
      subtitle={setup?.purpose ?? descriptor?.boundary}
      onClose={onClose}
      wide
    >
      <div className="connection-setup">
        <div className="connection-detail-state">
          <ProviderIcon large provider={provider} />
          {metadataOnly ? (
            <span className="connection-preview-badge">Configuration preview</span>
          ) : (
            <Status
              value={connection?.state}
              label={
                connected
                  ? "Connected"
                  : String(connection?.state ?? "not_connected").replaceAll(
                      "_",
                      " ",
                    )
              }
            />
          )}
        </div>
        <div className={`connection-boundary ${metadataOnly ? "is-preview" : ""}`}>
          <strong>{metadataOnly ? "Not implemented" : "Current capability boundary"}</strong>
          <p>{descriptor?.boundary ?? setup?.resourcePolicy}</p>
        </div>
        <div className="connection-settings-tabs" role="tablist" aria-label="Connection settings">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`connection-panel-${tab.id}`}
              disabled={tab.state === "locked"}
              title={tab.reason}
              className={activeTab === tab.id ? "is-active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {CONNECTION_TAB_LABELS[tab.id]}
              {tab.state === "preview" ? <small>Preview</small> : null}
            </button>
          ))}
        </div>
        {activeTab !== "overview" ? (
          <ConnectionSettingsPanel
            provider={provider}
            tab={activeTab}
            tabState={tabs.find((tab) => tab.id === activeTab)}
            setup={setup}
            connection={connection}
          />
        ) : (
          <div id="connection-panel-overview" role="tabpanel" className="connection-settings-panel">
        <p className="prose">{setup?.resourcePolicy ?? descriptor?.boundary}</p>
        {message ? <div className="notice">{message}</div> : null}
        {connection?.accountLabel ? (
          <p>
            Signed in as <strong>{connection.accountLabel}</strong>
          </p>
        ) : null}
        <ErrorMessage error={error} />
        {!setup && !metadataOnly ? (
          <Button busy={busy} onClick={reloadSetup}>
            Retry setup details
          </Button>
        ) : null}
        {!metadataOnly && !connected && setup?.configured === false ? (
          <div className="setup-instructions">
            <h3>One-time Google setup</h3>
            <p>
              Google requires a registered OAuth application before Frondose can
              open its sign-in page.
            </p>
            <ol>
              <li>
                Create an OAuth web client in Google Cloud and enable the Drive
                API.
              </li>
              <li>
                Add this authorized redirect URI:
                <code>{setup.callbackUrl}</code>
              </li>
              <li>
                Set these server environment variables and restart Frondose:
                <code>{setup.missing?.join("\n")}</code>
              </li>
            </ol>
            <p className="muted">
              This connection requests file names and metadata only. It cannot
              read or change file contents.
            </p>
          </div>
        ) : null}
        {!metadataOnly && !connected && setup?.installCommand ? (
          <div className="setup-instructions">
            <h3>Connect your {setup.displayName} installation</h3>
            <p>
              If you already signed in using {setup.displayName} on this
              computer, use that existing sign-in. Otherwise, start the
              provider’s sign-in flow.
            </p>
            <details>
              <summary>Need to install {setup.displayName}?</summary>
              <div className="copy-command">
                <code>{setup.installCommand}</code>
                <Button
                  icon={Copy}
                  onClick={() =>
                    perform(async () => {
                      await navigator.clipboard.writeText(setup.installCommand);
                      notify("Install command copied");
                    })
                  }
                >
                  Copy
                </Button>
              </div>
            </details>
          </div>
        ) : null}
        {authUrl ? (
          <a
            className="button primary auth-link"
            href={authUrl}
            target="_blank"
            rel="noreferrer"
          >
            Continue to sign in <ExternalLink />
          </a>
        ) : null}
        {authOutput ? (
          <pre className="auth-output">
            {Array.isArray(authOutput) ? authOutput.join("\n") : authOutput}
          </pre>
        ) : null}
        {!metadataOnly && !connected && setup?.configured !== false ? (
          <div className="connection-actions">
            {setup?.methods?.includes("existing") ? (
              <Button
                icon={Link}
                busy={busy}
                onClick={() => connect("existing")}
              >
                Use existing sign-in
              </Button>
            ) : null}
            {setup?.methods?.includes("browser") ? (
              <Button
                icon={ExternalLink}
                disabled={busy}
                onClick={() => connect("browser")}
              >
                Sign in with {setup.displayName}
              </Button>
            ) : null}
            {provider === "github" ? (
              <Button variant="ghost" onClick={() => setShowToken(!showToken)}>
                Use access token
              </Button>
            ) : null}
          </div>
        ) : null}
        {showToken ? (
          <Form
            className="token-form"
            onSubmit={(e) => {
              e.preventDefault();
              connect("token");
            }}
          >
            <Field
              label="GitHub access token"
              hint="Stored privately on this computer. It is never included in exports."
            >
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Fine-grained personal access token"
              />
            </Field>
            <Button type="submit" disabled={!token.trim()} busy={busy}>
              Connect token
            </Button>
          </Form>
        ) : null}
        {connected ? (
          <div className="connection-actions">
            <Button icon={RotateCcw} busy={busy} onClick={check}>
              Check connection
            </Button>
            {["github", "google-drive"].includes(provider) ? (
              <Button
                icon={Folder}
                disabled={busy}
                onClick={() => browse(false)}
              >
                Browse {provider === "github" ? "repositories" : "files"}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          </div>
        ) : authUrl || message || authOutput ? (
          <Button icon={RotateCcw} busy={busy} onClick={check}>
            I’ve signed in — check connection
          </Button>
        ) : null}
        {confirmDisconnect ? (
          <div className="disconnect-confirm">
            <p>
              Disconnect {setup?.displayName} from this workspace? Other
              workspaces, CLI sign-in, and your project data are unchanged.
            </p>
            <Button onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={() =>
                execute(async () => {
                  const result =
                    await frondoseActions.disconnectConnection(provider, { workspaceId: workspace.id });
                  setCurrent(result.connection);
                  setResources(null);
                  setConfirmDisconnect(false);
                  setMessage(result.message || "Disconnected in this workspace.");
                })
              }
            >
              Disconnect
            </Button>
          </div>
        ) : null}
        {resources ? (
          <section className="resource-browser">
            <div className="section-heading">
              <h3>{provider === "github" ? "Repositories" : "Drive files"}</h3>
              <span className="muted">{resources.length}</span>
            </div>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Filter results…"
            />
            {resources
              .filter((item) =>
                item.name.toLowerCase().includes(query.toLowerCase()),
              )
              .map((item) => (
                <div className="resource-result" key={item.id}>
                  <Folder />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.description ??
                        item.mimeType ??
                        (item.private ? "Private repository" : "Repository")}
                    </small>
                  </span>
                  {safeUrl(item.url) ? (
                    <a
                      className="icon-button"
                      href={safeUrl(item.url)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${item.name}`}
                    >
                      <ExternalLink />
                    </a>
                  ) : null}
                  <Button
                    onClick={() => {
                      if (provider === "github")
                        edit("project", null, {
                          name: item.name,
                          github_url: item.url,
                          description: item.description,
                        });
                      else
                        edit("memory", null, {
                          title: item.name,
                          content: `Google Drive reference: ${item.url}\n${item.mimeType ?? ""}`,
                        });
                      onClose();
                    }}
                  >
                    {provider === "github" ? "New project" : "Save reference"}
                  </Button>
                </div>
              ))}
            {nextPage ? (
              <Button busy={busy} onClick={() => browse(true)}>
                Load more
              </Button>
            ) : null}
            {!resources.length ? (
              <Empty
                compact
                kind="search"
                title="No resources returned"
                description="Check the permissions on your connected account."
              />
            ) : null}
          </section>
        ) : null}
        {safeUrl(setup?.docsUrl) ? (
          <a
            className="text-button external-docs"
            href={safeUrl(setup.docsUrl)}
            target="_blank"
            rel="noreferrer"
          >
            Provider setup documentation <ExternalLink />
          </a>
        ) : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ConnectionSettingsPanel({ provider, tab, tabState, setup, connection }) {
  const descriptor = CONNECTION_PROVIDERS[provider];
  const settings = defaultConnectionSettings(provider);
  const preview = tabState?.state === "preview";
  const baseName = CONNECTION_PROVIDERS[descriptor.baseConnection]?.displayName ?? descriptor.displayName;
  const sectionIntro = preview ? (
    <div className="connection-preview-note">
      <strong>Preview only</strong>
      <p>{tabState?.reason ?? "This configuration is defined but has no external execution service."}</p>
    </div>
  ) : null;

  if (tab === "commands") {
    return (
      <section id="connection-panel-commands" role="tabpanel" className="connection-settings-panel">
        {sectionIntro}
        <div className="connection-section-heading">
          <div><h3>Slash commands</h3><p>Commands contributed by this connection appear only as documented previews.</p></div>
          <span>{descriptor.commands.length} commands</span>
        </div>
        <div className="connection-command-list">
          {effectiveConnectionCommands(provider, settings).map((item) => (
            <article key={item.id}>
              <div>
                <code>{item.name}</code>
                <p>{item.summary}</p>
                <small>{item.effect} · {item.target.replaceAll("_", " ")} · {item.resourceScope.replaceAll("_", " ")}</small>
              </div>
              <button type="button" disabled title={item.disabledReason}>Unavailable</button>
            </article>
          ))}
        </div>
      </section>
    );
  }

  const panels = {
    resources: {
      title: "Allowed resources",
      description: "Limit this connection to explicitly selected provider resources.",
      rows: [
        ["Selection", settings.resources.allowed.length ? `${settings.resources.allowed.length} selected` : "No resources selected"],
        ["Refresh", settings.resources.refresh],
        ["Archive handling", settings.resources.includeArchived ? "Include archived" : "Exclude archived"],
      ],
    },
    mappings: {
      title: "Frondose destinations and mappings",
      description: "Choose how reviewed external objects would map into Frondose without treating synchronization as active.",
      rows: [
        ["Default intake", settings.mappings.intakeType],
        ["Sync direction", settings.mappings.syncDirection],
        ["Conflict policy", settings.mappings.conflictPolicy],
      ],
    },
    rules: {
      title: "Connection rules",
      description: "Rules would match provider events and prepare reviewed Frondose work. External event ingestion is not active.",
      rows: [["Rule execution", "Disabled"], ["Configured rules", String(settings.rules.items.length)], ["Agent launches", "Never automatic"]],
    },
    agents: {
      title: "Agent access",
      description: "A connected account never becomes an automatic agent tool. Access must be scoped independently.",
      rows: [["Allowed agents", "None selected"], ["Writable actions", "None"], ["Approval", "Required"]],
    },
    context: {
      title: "Context policy",
      description: "Control how authorized provider information could enter a reviewed agent context.",
      rows: [["Retrieval", settings.context.retrieval], ["Maximum items", String(settings.context.maxItems)], ["Citations", settings.context.requireCitations ? "Required" : "Optional"], ["Include automatically", "No"]],
    },
    notifications: {
      title: "Notifications",
      description: "Frondose can describe notification preferences, but external delivery is not configured.",
      rows: [["Frondose Inbox", settings.notifications.inbox ? "Enabled" : "Disabled"], ["External delivery", "Unavailable"], ["Digest", settings.notifications.digest]],
    },
    security: {
      title: "Security and scopes",
      description: "Review the implemented boundary separately from the provider capabilities proposed for later.",
      rows: [
        ["Base connection", baseName],
        ["Account state", connection?.state === "connected" ? "Connected" : "Not connected"],
        ["Granted scopes", setup?.scopes?.length ? setup.scopes.join(", ") : "None reported"],
        ["Consequential actions", "Always confirm"],
        ["Destructive actions", "Disabled"],
      ],
    },
    activity: {
      title: "Activity settings",
      description: "These preferences describe future connection records; this panel is not an external audit log.",
      rows: [["Retention preference", `${settings.activity.retentionDays} days`], ["Read events", settings.activity.includeReads ? "Include" : "Exclude"], ["External event ingestion", "Unavailable"]],
    },
  };
  const panel = panels[tab];
  if (!panel) return null;
  return (
    <section id={`connection-panel-${tab}`} role="tabpanel" className="connection-settings-panel">
      {sectionIntro}
      <div className="connection-section-heading"><div><h3>{panel.title}</h3><p>{panel.description}</p></div></div>
      <dl className="connection-setting-list">
        {panel.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value).replaceAll("_", " ")}</dd></div>)}
      </dl>
      <Button disabled>Settings unavailable</Button>
    </section>
  );
}
