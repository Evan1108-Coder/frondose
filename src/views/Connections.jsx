import { useEffect, useState } from "react";
import { Form } from "../components/Form.jsx";
import { ExternalLink, ArrowRight, Plug, CircleCheck, Copy, Folder, Search, RotateCcw, Link, ShieldCheck, X } from "../components/icons.jsx";
import { rumboApi } from "../data/api.js";
import { rumboActions } from "../data/useRumbo.js";
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

export function ConnectionsView() {
  const { data } = useApp();
  const [setups, setSetups] = useState([]),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    rumboApi
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
          Browse repositories and file references, then attach the right context
          to your work.
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
function ConnectionCard({ connection, setup, onOpen }) {
  const name =
    setup?.displayName ?? connection.display_name ?? connection.displayName;
  return (
    <article className="connection-card">
      <div className="connection-card-top">
        <ProviderIcon provider={connection.provider} large />
        <span
          className={`connection-state ${connection.state === "connected" ? "connected" : ""}`}
        >
          <i />
          {connection.state === "connected"
            ? "Connected"
            : connection.state === "connecting"
              ? "Connecting"
              : "Not connected"}
        </span>
      </div>
      <h3>{name}</h3>
      <p>{setup?.purpose ?? connection.description}</p>
      <div className="connection-card-footer">
        <span>
          {connection.provider === "google-drive"
            ? "Read-only metadata"
            : connection.provider === "claude"
              ? "Read & search"
              : connection.provider === "codex"
                ? "Analysis & coding"
                : "Repositories"}
        </span>
        <Button onClick={onOpen}>
          {connection.state === "connected" ? "Manage" : "Set up"}
          <ArrowRight />
        </Button>
      </div>
    </article>
  );
}
export function ConnectionDialog({ provider, setup: initialSetup, onClose }) {
  const { data, perform, notify, edit } = useApp();
  const [setup, setSetup] = useState(initialSetup),
    [current, setCurrent] = useState(null),
    [token, setToken] = useState(""),
    [showToken, setShowToken] = useState(false),
    [message, setMessage] = useState(""),
    [authUrl, setAuthUrl] = useState(null),
    [resources, setResources] = useState(null),
    [nextPage, setNextPage] = useState(null),
    [query, setQuery] = useState(""),
    [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { busy, error, execute, setError } = useAsync();
  const connection =
    current ?? data.connections.find((item) => item.provider === provider);
  const connected = connection?.state === "connected";
  useEffect(() => {
    let active = true;
    Promise.all([
      rumboApi.connectionSetup(provider),
      rumboApi.connectionStatus(provider),
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
  }, [provider]);
  const reloadSetup = () =>
    execute(async () => {
      const [s, c] = await Promise.all([
        rumboApi.connectionSetup(provider),
        rumboApi.connectionStatus(provider),
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
      rumboApi
        .connectionStatus(provider)
        .then((response) => {
          if (!active) return;
          setCurrent(response.result.connection);
          if (response.result.connection?.state === "connected") {
            setAuthUrl(null);
            setMessage("Connected successfully.");
            rumboActions.refresh({ quiet: true }).catch(() => {});
          }
        })
        .catch(() => {});
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [provider, connection?.state, authUrl]);
  const connect = (method) =>
    execute(async () => {
      const result = await rumboActions.connectConnection(provider, {
        method,
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
      const result = await rumboActions.checkConnection(provider);
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
      const response = await rumboApi.connectionResources(
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
  return (
    <Dialog
      title={setup?.displayName ?? provider}
      subtitle={setup?.purpose}
      onClose={onClose}
      wide
    >
      <div className="connection-setup">
        <div className="connection-detail-state">
          <ProviderIcon large provider={provider} />
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
        </div>
        <p className="prose">{setup?.resourcePolicy}</p>
        {message ? <div className="notice">{message}</div> : null}
        {connection?.accountLabel ? (
          <p>
            Signed in as <strong>{connection.accountLabel}</strong>
          </p>
        ) : null}
        <ErrorMessage error={error} />
        {!setup ? (
          <Button busy={busy} onClick={reloadSetup}>
            Retry setup details
          </Button>
        ) : null}
        {!connected && setup?.configured === false ? (
          <div className="setup-instructions">
            <h3>One-time Google setup</h3>
            <p>
              Google requires a registered OAuth application before Rumbo can
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
                Set these server environment variables and restart Rumbo:
                <code>{setup.missing?.join("\n")}</code>
              </li>
            </ol>
            <p className="muted">
              This connection requests file names and metadata only. It cannot
              read or change file contents.
            </p>
          </div>
        ) : null}
        {!connected && setup?.installCommand ? (
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
        {!connected && setup?.configured !== false ? (
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
              Disconnect {setup?.displayName} from Rumbo? Your external CLI
              sign-in is kept, and your project data stays here.
            </p>
            <Button onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={() =>
                execute(async () => {
                  const result =
                    await rumboActions.disconnectConnection(provider);
                  setCurrent(result.connection);
                  setResources(null);
                  setConfirmDisconnect(false);
                  setMessage("Disconnected from Rumbo.");
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
    </Dialog>
  );
}
