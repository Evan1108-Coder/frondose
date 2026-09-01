const CATALOG = Object.freeze({
  github: {
    displayName: "GitHub",
    authKind: "browser_oauth",
    purpose: "Repositories, issues, pull requests, and checks.",
    requiredEnvironment: ["RUMBO_GITHUB_CLIENT_ID", "RUMBO_GITHUB_CLIENT_SECRET"],
    scopes: ["read:user", "user:email"],
    resourcePolicy: "Repository access is selected through the GitHub App installation flow.",
  },
  "google-drive": {
    displayName: "Google Drive",
    authKind: "browser_oauth",
    purpose: "User-selected Drive files as project context.",
    requiredEnvironment: ["RUMBO_GOOGLE_CLIENT_ID", "RUMBO_GOOGLE_CLIENT_SECRET"],
    scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
    resourcePolicy: "Rumbo requests drive.file and imports only files selected with Google Picker.",
  },
  codex: {
    displayName: "Codex",
    authKind: "provider_managed",
    purpose: "Coding sessions through Codex App Server.",
    requiredEnvironment: [],
    scopes: [],
    resourcePolicy: "Codex App Server owns ChatGPT sign-in, credentials, history, and rate-limit state.",
  },
  claude: {
    displayName: "Claude",
    authKind: "api_or_cloud",
    purpose: "Claude Agent SDK sessions with explicit permissions.",
    requiredEnvironment: ["ANTHROPIC_API_KEY"],
    scopes: [],
    resourcePolicy: "Third-party Rumbo use requires Anthropic API or a supported cloud provider; Claude subscription OAuth is not offered.",
  },
});

export function listProviderSetups({ env = process.env, origin = "http://127.0.0.1:4173" } = {}) {
  return Object.keys(CATALOG).map((provider) => providerSetup(provider, { env, origin }));
}

export function providerSetup(provider, { env = process.env, origin = "http://127.0.0.1:4173" } = {}) {
  const definition = CATALOG[provider];
  if (!definition) return null;
  const missing = definition.requiredEnvironment.filter((name) => !env[name]);
  const callbackPath = provider === "github" ? "/api/auth/github/callback" : provider === "google-drive" ? "/api/auth/google-drive/callback" : null;
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
    resourcePolicy: definition.resourcePolicy,
    startAllowed: false,
    startReason: configured
      ? "Connection launch remains disabled during account-safe prototype testing. It can be enabled only from an explicit user action."
      : `Configure ${missing.join(" and ")} in the local server environment first.`,
    secretsPolicy: "Secret values are never returned to the browser or stored in Rumbo business tables.",
    liveAccountChecked: false,
  };
}

export function providerCatalog() {
  return CATALOG;
}
