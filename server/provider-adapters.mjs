const CATALOG = Object.freeze({
  github: {
    displayName: "GitHub",
    authKind: "cli_or_token",
    purpose: "Browse your repositories and link them to projects.",
    requiredEnvironment: [], scopes: [], methods: ['existing', 'browser', 'token'],
    resourcePolicy: "Uses GitHub CLI sign-in or a fine-grained access token. Repository access follows the permissions you grant.",
    docsUrl: 'https://cli.github.com/manual/gh_auth_login', installCommand: 'brew install gh',
  },
  "google-drive": {
    displayName: "Google Drive",
    authKind: "browser_oauth",
    purpose: "Browse Drive file names and links as project references.",
    requiredEnvironment: ["RUMBO_GOOGLE_CLIENT_ID", "RUMBO_GOOGLE_CLIENT_SECRET"],
    scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"], methods: ['browser'],
    resourcePolicy: "Read-only file metadata. Rumbo does not read file contents, create, edit, or delete Drive files.",
    docsUrl: 'https://developers.google.com/identity/protocols/oauth2/web-server',
  },
  codex: {
    displayName: "Codex",
    authKind: "provider_managed",
    purpose: "Run coding and analysis sessions through Codex CLI.",
    requiredEnvironment: [],
    scopes: [], methods: ['existing', 'browser', 'app_server'],
    resourcePolicy: "Codex owns sign-in and credentials. Runs start only when requested. Analysis uses a read-only sandbox; coding can write in the linked project.",
    docsUrl: 'https://developers.openai.com/codex/cli/reference/', installCommand: 'npm install -g @openai/codex',
  },
  claude: {
    displayName: "Claude",
    authKind: "provider_managed",
    purpose: "Run analysis sessions through Claude Code.",
    requiredEnvironment: [], scopes: [], methods: ['existing', 'browser'],
    resourcePolicy: "Claude Code owns sign-in and credentials. Rumbo limits tools to reading and searching. Programmatic usage can have separate billing limits under your provider plan.",
    docsUrl: 'https://code.claude.com/docs/en/headless', installCommand: 'brew install --cask claude-code',
  },
});

export function listProviderSetups({ env = process.env, origin = "http://127.0.0.1:4173" } = {}) {
  return Object.keys(CATALOG).map((provider) => providerSetup(provider, { env, origin }));
}

export function providerSetup(provider, { env = process.env, origin = "http://127.0.0.1:4173" } = {}) {
  const definition = CATALOG[provider];
  if (!definition) return null;
  const missing = definition.requiredEnvironment.filter((name) => !env[name]);
  const callbackPath = provider === "google-drive" ? "/api/auth/google-drive/callback" : null;
  const callbackUrl = callbackPath ? new URL(callbackPath, origin).toString() : null;
  const configured = missing.length === 0;
  return {
    provider,
    displayName: definition.displayName,
    purpose: definition.purpose,
    authKind: definition.authKind,
    configured,
    state: configured ? "ready_for_user_action" : "configuration_required",
    missing,
    callbackUrl,
    scopes: definition.scopes,
    methods: definition.methods, docsUrl: definition.docsUrl, installCommand: definition.installCommand,
    resourcePolicy: definition.resourcePolicy,
    startAllowed: configured,
    startReason: configured
      ? "Connect explicitly to check or sign in to your account."
      : `Configure ${missing.join(" and ")} in the server environment, enable the Drive API, register this callback URL in Google Cloud, and restart.`,
    secretsPolicy: "CLI credentials stay with the provider. Optional GitHub and Google tokens are stored in a private server file, never returned to the browser or exported.",
    liveAccountChecked: false,
  };
}

export function providerCatalog() {
  return CATALOG;
}
