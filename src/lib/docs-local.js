export const DOC_LOCAL = [
  {
    id: 'interface-languages',
    group: 'getting-started',
    title: 'Choose an interface language',
    description: 'Find a language or regional format and see what it changes.',
    appLink: {view:'settings',id:'languages',label:'Open Languages'},
    related: ['workspace-setup','local-frondose'],
    sections: [
      {id:'choose-language',title:'Find and select a language',paragraphs:[
        'Click the language code in the main toolbar or open Settings → Languages. Search by the native name, English name, or language code, such as Français, Japanese, or pt-BR. The change applies immediately on this device without restarting or stopping your sessions.',
        'English is the full interface. Chinese (Simplified and Traditional), French, German, Italian, Japanese, Korean, Brazilian Portuguese, and Spanish include bundled interface and handbook translations. Those languages remain in preview while uncommon messages and wording are reviewed. No translation service is used at runtime.',
      ]},
      {id:'region-formats',title:'Regional formats and unchanged content',paragraphs:[
        'Formatting-only options keep the interface in English and change calendar labels and the formatting examples in Languages. Dates are still stored in the same format. Arabic, Hebrew, Persian, and Urdu options do not mirror the entire app layout.',
        'Your files, notes, comments, terminal output, AI responses, and websites remain in their original language. Frondose never sends them to a translation service when you change this preference.',
      ]},
    ],
  },
  {
    "id": "to-do-list",
    "group": "workspace",
    "title": "To Do List",
    "description": "A simple local priority board for your workspace and each Area.",
    "appLink": {
      "view": "todos",
      "label": "Open To Do List"
    },
    "related": [
      "review-notes",
      "local-frondose",
      "todo-resource-links"
    ],
    "sections": [
      {
        "id": "priorities",
        "title": "Four priorities, two work lanes",
        "paragraphs": [
          "Use the red Urgent and important column, blue Important, not urgent column, amber Urgent, not important column, and green Neither urgent nor important column. Each has a count and a small create button. In Progress and Finished are horizontal lanes below. Color reinforces the written label; it is not the only status cue.",
          "Click a card for its title, description, separate AI prompt, dates, Area, available local Lead AI and resources. Choose No Areas, Selected Areas (one or several), or All Areas in the task editor. All Areas includes future Areas in this workspace. The workspace board includes every task once; Area boards show the same shared tasks assigned to them. Choosing a Lead AI is metadata and does not launch it."
        ]
      },
      {
        "id": "organize",
        "title": "Move and find your work",
        "paragraphs": [
          "Priority and status are independent. In Progress tasks appear in their priority column and In Progress lane. Completed tasks retain their priority but move out of active priority columns into Finished; Finished To Do provides a separate completed-work view. New tasks start In Progress. Dragging across priority columns changes only priority; dragging into a status row changes only status. Area assignments are retained. On narrow panes the priority columns reflow to two or one without compressing text into a vertical strip. Use Search to-dos or global Search to find title, description, prompt and resource labels.",
          "Saved changes are local database records with version checks and idempotent retries. Stale edits fail rather than overwriting newer work. Archive removes a task from active boards; Archived lets you restore it. Drafts require explicit Save and are protected before leaving.",
          "Hover or focus a card for Mark as Finished and Delete, or use its right-click menu. Completion retains the priority, checklist and resource links and moves the card into Finished. You can still delete it from the Finished lane or the Finished To Do view. Delete requires confirmation and permanently removes the task from all its boards, without deleting linked files or resources. Use Archive if you may want to restore the task."
        ]
      },
      {
        "id": "resources",
        "title": "Resources and prompt context",
        "paragraphs": [
          "Use Add resource below the link field to browse saved workspace files, comments, projects, Routes, Areas and documents. Choose multiple resources, then Done; Save to-do commits the draft. You can also drop a saved resource into Related resources or add an HTTP(S) link. Resource links are references, not new access grants. A changed directory binding must be re-linked before its file can open.",
          "Hover a prompted card to copy its prompt. Drag a card into a suitable Frondose text input or editor to insert its freshly read task context. An AI CLI drop inserts only a draft using safe multiline paste. It never presses Enter."
        ]
      }
    ]
  },
  {
    "id": "workspace-setup",
    "group": "getting-started",
    "title": "Workspace setup and CLI commands",
    "description": "Finish your workspace checklist and customize installed CLI tools without starting work.",
    "appLink": {
      "view": "settings",
      "id": "onboarding-checklist",
      "label": "Onboarding Checklist"
    },
    "related": [
      "local-frondose",
      "terminals",
      "review-notes"
    ],
    "sections": [
      {
        "id": "checklist",
        "title": "A checklist for each workspace",
        "paragraphs": [
          "Onboarding Checklist is the first Settings entry until completed. Frondose observes a linked directory, a saved default CLI, a first Route and a successfully opened native Browser tab. You may explicitly skip a step for now; skipped is not the same as completed. Progress is saved on this device separately for each workspace.",
          "Finishing shows a bottom-right celebration. The next Settings visit retires its navigation entry with a short sparkle. Reduced-motion preferences remove animated effects. A failed local preference save is reported, not silently accepted."
        ]
      },
      {
        "id": "commands",
        "title": "CLI Agents settings",
        "paragraphs": [
          "Settings → CLI Agents lists detected command-line tools. Refresh Detection checks executable paths without running an agent, installing anything, authenticating or sending prompts. Make Default changes the ordering in AI Sessions → Terminal for this workspace. The local CLI continues to own its login, models and permissions.",
          "Customize lets you review an executable and a literal JSON argument array for future manually opened sessions in this workspace. Saving never runs the command. Empty executable restores automatic detection. Native Resume and reviewed scheduled tasks keep their canonical commands; existing terminals stay unchanged. Paths and arguments are deliberately excluded from Field Defaults."
        ]
      },
      {
        "id": "detection",
        "title": "Installed does not mean signed in",
        "paragraphs": [
          "Detection adapts licensed Orca filesystem lookup for inherited PATH, Node version managers and supported native locations. Frondose additionally checks the actual executable in known Codex and ChatGPT Mac app bundles. A missing or non-executable binary is not marked installed; provider account/model access is not checked by detection."
        ]
      },
      {
        "id": "context",
        "title": "Drag or copy saved comments",
        "paragraphs": [
          "Drag a saved comment card or its dedicated handle into an AI CLI to insert fresh workspace-scoped draft context. Buttons, reply fields and other controls retain their interactions. Comments no longer have a Send to AI button; use drag or copy instead. Insertion is a draft and never presses Enter.",
          "Copy context uses a trusted write-only native clipboard bridge in the desktop app. If a web browser denies clipboard writes, Frondose shows selectable context for manual copy instead of claiming success. Browser guests do not receive this native bridge."
        ]
      }
    ]
  },
  {
    "id": "review-notes",
    "group": "workspace",
    "title": "Inline comments and review notes",
    "description": "Attach discussions to exact saved file selections and review them with your CLI.",
    "sections": [
      {
        "id": "writing",
        "title": "Edit and save workspace files",
        "paragraphs": [
          "Markdown files offer Source and Preview, while code and plain text open in the source editor. Edits remain in a draft until you choose Save. A conflicting disk change does not overwrite your draft. The visual block editor is available for in-app Docs.",
          "Saved comments expose drag and copy, not Send to AI. Drop a comment or task into a Frondose text field, code editor or Docs editor to insert fresh reference text. AI CLI drops insert a draft directly without a popup and never press Enter; ordinary terminal insertion prefixes reference lines as shell comments and requires safe multiline paste. Input or target changes during loading cancel the drop. Browser guests and arbitrary native application inputs do not share Frondose’s private drag capabilities. Image references are Markdown/path references, not uploaded image bytes."
        ]
      },
      {
        "id": "start",
        "title": "Find the note controls",
        "paragraphs": [
          "Open a saved text or code file. Hover a nonempty source line for the plus in its left gutter. Select text first to comment on that exact range. In Markdown Preview, hover a paragraph or select across paragraphs for the left-edge plus. The composer stays beside the selection rather than opening a centered modal. On narrow panes, notes move below the document.",
          "The Comments control in the file header opens all notes for that file. Save unsaved file changes before creating an anchor. If the local server is older than the interface, Frondose explains that its backend needs a safe restart; it does not stop terminals automatically."
        ]
      },
      {
        "id": "threads",
        "title": "Reply, react and resolve",
        "paragraphs": [
          "Open a saved note to reply, react or resolve it. Notes retain a file-version anchor and show Outdated after the file changes. Reattach only a uniquely matched exact quote after review; ambiguous selections require returning to Source. Comments do not modify the file content. Unsaved note/reply drafts keep navigation guards."
        ]
      },
      {
        "id": "handoff",
        "title": "Review with an AI CLI",
        "paragraphs": [
          "Drag a saved note or comment card into a running AI CLI to insert fresh, bounded reference text directly into its draft. There is no Send to AI control and no context-preview popup. File drags insert the path rather than the entire file. A changed input/target or unavailable safe multiline paste rejects insertion. Nothing presses Enter or starts a provider request. Browser guests and arbitrary native apps do not share private Frondose drag capabilities."
        ]
      }
    ],
    "related": [
      "files-search",
      "terminals",
      "repository-work",
      "rich-writing"
    ]
  },
  {
    "id": "open-app-tabs",
    "group": "workspace",
    "title": "Open tools in workspace tabs",
    "description": "Choose the built-in editor, browser, repository tools or a supported web application.",
    "sections": [
      {
        "id": "choose",
        "title": "Open App",
        "paragraphs": [
          "From New tab, choose Browser directly for a blank Chromium tab, or open Open App for other tools. Each Open App option has a visual tool identity and a Go to Docs action. Text editor is Frondose’s built-in code/Markdown editor. Browser is an isolated Chromium session with an editable address bar, including localhost, not your normal Chrome profile. The GitHub Dashboard reports local file and branch state; explicit connected GitHub reads add issues, pull requests and checks."
        ]
      },
      {
        "id": "vscode",
        "title": "VS Code Web",
        "paragraphs": [
          "VS Code Web is shown only after detecting the installed editor. Its separate local web server must be explicitly set up on loopback with authentication; review Microsoft’s download/license steps yourself. Frondose never embeds a native desktop window or starts the web server on menu hover. A native editor already open is a detected setup boundary, not proof of synchronization."
        ]
      },
      {
        "id": "repository",
        "title": "Repository tools and worktrees",
        "paragraphs": [
          "Source control, Worktrees and Repository tasks use the bound directory. Reading does not stage, commit, create a checkout or launch AI. Changes and launches require their exact reviewed actions. Projects are planning records; worktrees are separate checked-out directories sharing Git history, not extra projects or security sandboxes."
        ]
      },
      {
        "id": "remote",
        "title": "Remote desktop and other apps",
        "paragraphs": [
          "Only supported browser-compatible endpoints can run inside a tab. Native-only editors and Parallels Desktop do not become embeddable merely because they are installed. Existing approved HTTPS gateways require their own endpoint and access review. Unsupported app options remain clearly labelled, not simulated."
        ]
      }
    ],
    "related": [
      "files-search",
      "repository-work",
      "local-frondose"
    ]
  },
  {
    "id": "local-automations",
    "group": "workspace",
    "title": "Local CLI automations",
    "description": "Schedule exact reviewed Routes while your computer and host are awake.",
    "sections": [
      {
        "id": "create",
        "title": "Create and review",
        "paragraphs": [
          "Open Automations from the sidebar or New tab. Start with a template, save a task as a Route, or select an existing Route. Choose an installed supported CLI, inspect the exact first task, set the first run and repeat interval, and explicitly approve possible usage charges and OS-user execution. Templates alone do not start work."
        ]
      },
      {
        "id": "runs",
        "title": "Dispatch and overlap safety",
        "paragraphs": [
          "Start a new CLI session every run with Codex or Claude Code. For a scheduled Codex run, you can also continue a compatible completed Frondose Codex conversation, or let the automation create and reuse its own conversation. These continuing modes run read-only and show the result in Chat. Frondose will not type into an arbitrary live terminal or automatically start a new conversation if it cannot verify the reviewed session.",
          "Dispatched means work was opened, not that an AI task finished or its output was accepted. The continuing Codex modes record completion when the provider confirms the turn ended. Active or uncertain workspace work prevents overlapping launches. Missed schedules are skipped rather than replayed as a burst. Changed Route or directory data pauses the old grant until re-reviewed.",
          "Enable Include recent workspace activity to append a bounded snapshot to future scheduled prompts. This is optional per automation and requires a fresh review. It does not trigger a run or add context to a one-time Run now."
        ]
      },
      {
        "id": "manage",
        "title": "Pause, edit and manual runs",
        "paragraphs": [
          "Search and filter saved schedules, inspect Runs and open the owned terminal. Pause stops future occurrences without stopping a running terminal. Review/edit requires fresh consent for the revised exact task. Run now asks separately before a one-time dispatch. The host must remain awake; closing the app’s view does not necessarily stop an external host."
        ]
      }
    ],
    "related": [
      "terminals",
      "repository-work",
      "project-reviews-automations"
    ]
  },
  {
    "id": "repository-work",
    "group": "workspace",
    "title": "Tasks, worktrees and source control",
    "description": "Give independent tasks their own checkout and review actual local changes.",
    "related": [
      "local-frondose",
      "github-routes",
      "terminals"
    ],
    "appLink": {
      "view": "workspace",
      "label": "Open workspace"
    },
    "sections": [
      {
        "id": "checkouts",
        "title": "Independent task directories",
        "paragraphs": [
          "Repository tools already open in a workspace keep their tabs and data after the New tab chooser is simplified. Create a dedicated sibling checkout from an existing local base and a new frondose/ branch, optionally seeded by a saved Route or explicitly read GitHub issue. It copies committed base files, not drafts or credentials. Open workspace binds a separate local workspace; it never launches AI automatically. Worktrees share Git history and OS-user permissions, not security isolation."
        ]
      },
      {
        "id": "review",
        "title": "Review changes and notes",
        "paragraphs": [
          "Review working/staged diffs and exact-version inline notes before selected-path staging or commit. Native Codex/Claude Route launches require explicit first-task review and consent. GitHub fetch/push/PR creation additionally requires a connected repository and explicit external action. Markdown selection notes use a margin rail rather than a centered dialog. Changed anchors remain outdated until reviewed. No task automatically becomes accepted, no drag presses Enter, and no autonomous orchestration bridge is implied."
        ]
      }
    ]
  },
  {
    "id": "local-frondose",
    "group": "getting-started",
    "title": "Frondose on your computer",
    "description": "A project directory, native CLI tools, browser-like tabs, and local planning in one workspace.",
    "appLink": {
      "view": "settings",
      "id": "local-installation",
      "label": "Local installation"
    },
    "related": [
      "navigation",
      "files-search",
      "terminals"
    ],
    "sections": [
      {
        "id": "desktop-tools",
        "title": "Open in installed apps",
        "paragraphs": [
          "Settings → Open in Apps detects VS Code, Cursor and Zed, and supports native-picker custom editor entries. Rename or remove an entry without launching it. The workspace Open in menu opens only after an explicit click and freshly checks the linked directory. Detected iTerm2, Ghostty, Terminal, Windows Terminal and supported Linux terminals appear under New tab → External terminal. These are external windows, not alternative embedded terminal renderers. Detection never launches an application."
        ]
      },
      {
        "id": "terminal-settings",
        "title": "Terminal and appearance preferences",
        "paragraphs": [
          "Settings → Terminal offers system or native-picker custom shell selection for future shells, safe GPU fallback, bounded SIXEL/iTerm2 image support, scroll multipliers, clipboard/focus behavior, scrollback and platform keyboard controls. Existing sessions are not restarted when display preferences change. Kitty graphics is not supported. Manage sessions freshly verifies saved tab ownership and asks before stopping an entire selected tab, including its split panes. There is no fictitious daemon restart or automatic process recovery.",
          "Appearance offers UI zoom/font/sidebar style and separate terminal font/theme previews. Explicit Ghostty or Warp/YAML file imports retain only allowlisted colors/font settings; commands, includes and other source content are not imported. Resource manager shows actual Frondose desktop process metrics. Ports lists system TCP listeners, not invented workspace ownership. Unsupported provider quotas and remote hosts are not shown as working indicators."
        ]
      },
      {
        "id": "native-integrations",
        "title": "Seven local service integrations",
        "paragraphs": [
          "Settings → Integrations provides GitHub, GitLab, Bitbucket Cloud, Azure DevOps, Gitea, Linear and Jira Cloud. Open a provider’s overview and setup guide first. Choose Connect to enter its specific credentials, verify them, then explicitly select repositories, teams or projects. Credentials are encrypted by the OS keychain/credential service, never stored in browser preferences or sent to a Frondose cloud. Secure storage must be available; plaintext fallback is refused. GitLab/Gitea custom hosts require public HTTPS; private-network enterprise hosts are not supported by this transport.",
          "Reads are on demand and bounded to 100 resources / 50 items. Remote issue creation, comments, merging, pushes and background synchronization are not enabled. The provider itself controls access, expiration and rate limits. No Frondose OAuth registration or provider account is silently created. Bitbucket uses modern scoped API tokens rather than retired app passwords. Disconnect removes only the local saved connection; revoke the token at the provider if needed."
        ]
      },
      {
        "id": "native-updates",
        "title": "Installing app updates safely",
        "paragraphs": [
          "When a compatible update is ready, click Update in the bottom-right popup, or review it in Settings → App updates. Minimize returns progress to the bottom right without cancelling the update. Fresh checks protect running work, pending saves and unsaved drafts. A missed schedule after sleep or shutdown asks again instead of interrupting work. A separately started terminal host is never stopped by the app updater.",
          "On macOS, an owner-staged local build can use the same updater without a public feed. Frondose verifies the staged build, keeps a copy of the previous app and a workspace backup, then reopens. Local ad-hoc signing checks bundle integrity, not publisher identity. Public automatic installation requires a configured, publisher-signed release."
        ]
      },
      {
        "id": "local",
        "title": "One workspace, one directory",
        "paragraphs": [
          "Frondose runs on your computer with a loopback server and private local database. Explicitly choose a specific project directory for each workspace. Binding a directory does not move or delete existing records, grant a provider account, or start a process. The file explorer appears at the right; the left navigation keeps project planning and workspace tools available. You do not need a Frondose cloud account, human team, or subscription. Historical attribution remains stored rather than silently deleted."
        ]
      },
      {
        "id": "providers",
        "title": "Use your installed CLI tools",
        "paragraphs": [
          "Settings → Local installation detects executable commands without running them, installing packages, signing in, or sending a model prompt. Choose Terminal in New tab, or launch an installed CLI from Settings → CLI Agents → Open AI Sessions → Terminal: the linked workspace directory is automatic, or the server-selected OS home is used when no directory is linked. The CLI manages its own login, models, prompts and permissions. Detection is not authentication and does not prove offline model access. Frondose does not import or synchronize website chat histories. Opt-in Session history search indexes supported Codex/Claude Code title and message text locally and resumes exact native sessions only in their original linked directory. Other CLIs use their own history commands."
        ]
      },
      {
        "id": "allowance",
        "title": "Codex plan allowance",
        "paragraphs": [
          "In Frondose desktop, the bottom Codex meter reads your installed CLI account’s actual quota windows and reset times. These are account-wide allowances shared with other Codex clients, not token costs or work performed only in this workspace. The meter shows the percentage left by default (55% used means 45% left). Settings → Appearance → Usage percentages can switch between Remaining and Used; labels and bars always match. Click the meter for details or Refresh usage. Reads are cached and paused while the window is hidden. An expired window shows Reset pending rather than an invented reset to zero.",
          "The short-lived usage helper initializes Codex app-server, reads account status without requesting token refresh, then reads rate limits. It starts no thread or model prompt, changes no login and consumes no reset credit. Provider credentials are never returned to the interface. Sign-in, API-key-only, unavailable data and failed reads have distinct explanations. Claude Code plan meters remain unavailable."
        ]
      },
      {
        "id": "browser",
        "title": "Browse in a workspace tab",
        "paragraphs": [
          "Browser is a direct New tab option, including without a project directory. In the Mac, Windows or Linux desktop host it opens a blank, isolated Chromium page. Type a website or localhost address in the top bar, or submit ordinary words to search with Google; Back, Forward and Reload use that tab’s actual navigation history. The Chromium label describes the embedded engine, not an installed Google Chrome or Firefox profile.",
          "Switching tabs hides a browser page without destroying it. Closing explicitly ends it and may discard unsaved website forms. Pages cannot access Frondose’s native bridge, local database or preload. Downloads, media and filesystem permissions remain disabled until a dedicated permission workflow exists; use the explicit external-browser action if needed. The ordinary web version cannot embed arbitrary websites.",
          "Use Import browser data in the Browser toolbar. Choose a detected macOS Chrome, Edge, Brave, Arc, Vivaldi, Comet, Helium, Firefox, or readable Safari profile, or choose a JSON or Safari cookie export file on desktop. Allow the native read prompt, choose sites in the preview, and confirm the import. The preview expires after two minutes. Reload the destination page after import. Other workspaces and the source browser are unchanged.",
          "Choose Cookies and sign-ins to copy website cookies, or Saved passwords to copy saved logins. Cookie imports may replace matching cookies; expired, unsupported and partitioned cookies are skipped, and browser-bound sign-ins may still require signing in again. Bookmark, history and passkey data are not imported.",
          "Saved passwords support eligible Chrome, Edge, Brave, Arc, Vivaldi, Comet and Helium profiles on macOS, and password CSV exports on desktop where OS encryption is available. For Firefox and Safari passwords, use an export instead of the profile. Select sites to import into the encrypted workspace vault. The key button on a matching HTTPS site lets you fill a supported empty sign-in form without submitting it, or remove the saved login. Exports contain plaintext: keep them private and remove them when no longer needed. Frondose does not bypass Keychain or other OS permissions."
        ]
      },
      {
        "id": "tabs",
        "title": "Files and sessions have different lifetimes",
        "paragraphs": [
          "Navigation normally replaces the active workspace tab, but an AI CLI is protected and new destinations open beside it. Right-click to rename, safely refresh, show vertical tabs or combine up to eight resizable views. On narrow phone screens, switch between focused views rather than squeezing all panes together. Markdown Source and Preview share one edit buffer. Save writes with conflict checks; failed saves keep the draft, and unsaved edits get Save, Discard and Cancel. Settings and Docs are separate screens, not tabs. Browser sessions have an editable address bar for websites and local HTTP development servers in the desktop host. Closing a terminal view and stopping its process remain separate actions."
        ]
      },
      {
        "id": "workflow",
        "title": "Local work and clear feedback",
        "paragraphs": [
          "The optional GitHub header uses a detected existing remote and an explicitly checked GitHub CLI account. Issues and PR reads are deliberate, Projects opens GitHub externally, and safe branch changes refresh Files. No automatic stash, reset or push is implied. Quick Commands saves text until Insert, Run or Send is chosen. Terminal preferences work for linked-project or unbound home scopes without launching work. Onboarding’s fourth step requests a welcome notification automatically; system acceptance, permission and visible banners are distinct. What’s New opens release notes in a centered reader with Go to Docs, not a working installer or a promise of automatic updates."
        ]
      },
      {
        "id": "safety",
        "title": "Local is not a sandbox or a cloud service",
        "paragraphs": [
          "Native terminals and provider tools run as your operating-system user and can access files or networks allowed by that account and their own configuration. Choose trusted folders and review commands. Cloud providers still receive whatever their CLI sends, and provider charges may apply. This computer and Frondose must stay running for local sessions; phone access, public hosting, cross-device synchronization, and cloud backup are not implied. A local lock can protect Frondose browser sessions but is not an operating-system sandbox. Stopping a process cannot undo completed edits or charges."
        ]
      }
    ]
  },
  {
    "id": "github-routes",
    "group": "projects-routes",
    "title": "GitHub issues as Routes",
    "description": "Opt in to bounded issue imports without overwriting local work or writing to GitHub.",
    "appLink": {
      "view": "settings",
      "id": "github",
      "label": "GitHub settings"
    },
    "related": [
      "projects",
      "routes",
      "local-frondose"
    ],
    "sections": [
      {
        "id": "connect",
        "title": "Connect the actual workspace repository",
        "paragraphs": [
          "Use the GitHub button to explicitly connect the selected directory’s existing github.com remote. The installed GitHub CLI keeps its own login; detecting a remote is not consent or authentication. Settings → GitHub is gray until connected. Opening settings only reads local repository status; it never reads issues, logs in or starts a session. A running older backend needs a safe update/restart to expose the new endpoints. Keep active terminal sessions running until that restart is approved."
        ]
      },
      {
        "id": "configure",
        "title": "Choose what becomes a Route",
        "paragraphs": [
          "Choose a destination Area and/or project, issue state, search, required labels, assigned-to-me filter, description and label-copy options. Projects use their own Area. Automatic import is off by default; Save records your choices without reading GitHub. Sync now explicitly imports a bounded batch. Enable automatic import to authorize checks every 5–60 minutes while the local server runs. Each check uses current GitHub CLI repository access.",
          "Checks read at most 25, 50 or 100 issues. A reached cap is reported, not presented as a complete backfill. Use narrower date/search filters to cover older ranges deliberately. Descriptions are capped at 12,000 characters. Closed issues do not automatically mark their Routes complete or accepted."
        ]
      },
      {
        "id": "safety",
        "title": "Keep edits and source identity intact",
        "paragraphs": [
          "Each workspace, repository and issue-number source imports once and retains its native issue URL. Imports are create-only: later checks never overwrite local title, description, status, labels or destination. Deleting a Route does not recreate it later; its source tombstone stays. Destination changes affect only new imports. No GitHub issue edits, comments, pushes, Git fetches or agent launches are performed by this source.",
          "Changing the directory, physical root, binding revision, remote, explicit connection or destination permissions stops the old configuration. Review and save it again. Current source, configuration and access are rechecked after network reads before the atomic local write. Network failures preserve existing work and back off to the interval. Source mappings and settings persist in the private local database; they contain no credentials."
        ]
      },
      {
        "id": "blame",
        "title": "Inspect local committed file history",
        "paragraphs": [
          "Files → Changes → Blame requires a connected GitHub repository, but reads only local committed HEAD history. It does not contact GitHub, fetch history or run text conversion commands. Uncommitted-only files can use Recent changes instead. Blame is identified as committed history, not current unsaved text; current file and directory revisions are checked around the read."
        ]
      }
    ]
  }
];
