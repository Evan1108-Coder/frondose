// Dated local development milestones; not fabricated public release dates.
export const DOC_NOVEMBER = [
  {
    id:'release-candidate-fixes',group:'updates',date:'2026-11-15',
    title:'Browser, Chat and workspace reliability fixes',
    description:'Keep local paths private, remove saved Chat transcripts, and make task creation clearer.',
    sections:[
      {id:'browser-address',title:'Local paths stay out of Browser search',paragraphs:['The Browser address bar still accepts ordinary search queries and HTTP or HTTPS links. If you enter a file path beginning with a home or relative path prefix, Frondose now asks you to open the file from Explorer instead of sending the text to a search provider.']},
      {id:'chat-reliability',title:'Remove a saved Chat from Frondose',paragraphs:['Choose Delete conversation and confirm to remove a saved Frondose transcript. Provider-native history is unchanged, and active or automation-linked conversations stay protected. Chat also rejects outdated send reviews and no longer reports a provider stream as successful without its required completion signal.']},
      {id:'finished-tasks',title:'Create tasks in the active board',paragraphs:['New tasks start In Progress. Use the workspace or Area board to add one, then mark it Finished when done. The Finished-only view no longer offers a Create button that would immediately send the new item to a different view.']},
      {id:'settings-and-docs',title:'Find settings and current release notes',paragraphs:['Browsing the Integrations catalog no longer requests access to encrypted credentials. An explicit credential action can still require permission from your operating system. Settings search filters the visible page picker in narrow windows. The Docs home and What’s New navigation show the latest authored update first.']},
      {id:'archive-limits',title:'Know what an archive can restore',paragraphs:['Storage now labels the workspace JSON archive as a partial export. Project files, uploads, To Do items, local automations, AI Sessions chats and activity history are not included. Restoring a JSON archive makes a new workspace from the supported records and leaves the original untouched.']},
    ],related:['ai-sessions','to-do-list','review-update-cleanup'],
  },
  {
    id:'language-and-workspace-controls',group:'updates',date:'2026-11-15',
    title:'More translated screens and workspace controls',
    description:'Use more of Frondose in your chosen language, manage automations, and see what still owns a workspace directory.',
    sections:[
      {id:'language',title:'Language throughout the workspace',paragraphs:['The sidebar, workspace tabs, file explorer, status bar and built-in guides use bundled translation packs. Comments, files, names, terminal output and websites stay as written. Formatting-only language choices do not translate the app.']},
      {id:'automations',title:'Pause, resume or delete an automation',paragraphs:['Pause stops future launches, not a running session. Resume reuses unchanged reviewed settings and skips missed times. If its Route or directory changed, or a one-time schedule expired, review it before enabling it again. Delete removes the schedule but keeps its Route and run history.']},
      {id:'directory',title:'See why a folder cannot change',paragraphs:['The workspace directory dialog lists terminals that are still running, including ones left running after their tabs closed. Stop only the terminal you choose, then link the new directory. A real directory change remains protected until work has stopped.']},
      {id:'codex',title:'Find locally saved Codex chats',paragraphs:['Browse all Codex chats opens the provider’s own resume picker across folders. Frondose’s separate, opt-in All local sessions index can show archived Codex chats; restore those in Codex to resume. Neither path can recover unsaved or missing session files.']},
      {id:'notification',title:'Test system delivery without enabling alerts',paragraphs:['Open Settings → Notifications and choose Test notification. The result reflects what the system reports. Focus and system notification preferences can still hide a banner.']},
    ],related:['interface-languages','local-automations','workspace-setup'],
  },
  {
    id:'delete-to-dos',group:'updates',date:'2026-11-14',
    title:'Delete active or finished to-dos',
    description:'Delete a card from the To Do List without first moving it out of Finished.',
    sections:[
      {id:'delete-card',title:'Delete a card',paragraphs:['Hover or focus an in-progress card to see Finish and Delete side by side. Finished cards keep the Delete button in the Finished lane and on the separate Finished To Do page. Right-click any active or finished card for the same Delete action. Frondose asks you to confirm the selected card before permanently removing it.']},
      {id:'archive-instead',title:'Use Archive to keep a recovery option',paragraphs:['Deleting one task removes it from its workspace and every Area where that same card appears. Other tasks and linked files and resources are not deleted. Use Archive instead if you might want to restore the task later.']},
    ],related:['to-do-list'],
  },
  {
    id:'area-creation-navigation',group:'updates',date:'2026-11-14',
    title:'Open an Area right after creating it',
    description:'New Areas open when their save completes, without a false warning about a pending operation.',
    sections:[
      {id:'create-area',title:'Open your new Area',paragraphs:['Create an Area from the sidebar or the Areas page. Once Frondose saves it, the editor closes and the new Area opens. Previously, the editor could still report its completed save as pending and block that navigation. If a save fails, the editor remains open so you can keep editing or retry.']},
      {id:'protect-drafts',title:'Keep other unsaved work protected',paragraphs:['The fix only releases the guard for the editor that just saved. If another editor still has a draft or a file operation is in progress, Frondose continues to warn before leaving. Dismissing such a warning does not delete the saved Area or its contents.']},
    ],related:['workspace-activity'],
  },
  {
    id:'desktop-release-hardening',group:'updates',date:'2026-11-14',
    title:'Workspace activity and desktop reliability',
    description:'See recent workspace actions, review them before adding them to Chat, and recover individual integrations.',
    sections:[
      {id:'desktop-startup',title:'Keep desktop controls on the Frondose server',paragraphs:['Frondose desktop starts its own loopback server for the workspace. If another process already owns the configured port, the app stops startup and reports the conflict. It no longer opens that process’s page with desktop permissions. Close the conflicting server or use another port before starting Frondose.']},
      {id:'recover-integration',title:'Recover one local integration at a time',paragraphs:['A damaged integration record no longer prevents the rest of the provider list from loading. Use the recovery action for the affected provider only, then reconnect with its documented credentials. This removes the saved Frondose connection, not the external provider account or token.']},
      {id:'route-activity',title:'See activity on workspace Routes',paragraphs:['Routes that do not belong to a project or Area now open their Activity history using the current workspace’s access rules. Project and Area Routes retain their existing access checks.']},
      {id:'workspace-activity',title:'Review workspace activity',paragraphs:['Open Settings → Workspace activity to see recent saves, planning changes, published updates, and confirmed Git actions from Frondose. Add recent activity to a Chat draft or opt in for a scheduled automation. Nothing is shared just by viewing the log.']},
      {id:'editor-controls',title:'Save on purpose and read highlighted text',paragraphs:['Workspace files no longer show Write or Autosave. Edit in Source, preview Markdown as needed, then choose Save. The separate in-app Docs writing experience is unchanged. Text selection is white in dark mode and dark in light mode.']},
      {id:'language-search',title:'Find your language or regional format',paragraphs:['Find 80 language and regional options by native name, English name, or locale code. English is complete; nine languages preview translated controls, and formatting-only choices change calendar labels and examples without translating the interface. Content and active sessions remain untouched.']},
      {id:'automation-sessions',title:'Choose what a scheduled run opens',paragraphs:['Start a fresh CLI each time, or schedule Codex in a completed Frondose conversation or a dedicated conversation that the automation reuses. The two continuing modes are read-only and do not resume arbitrary live terminals. A missing or uncertain session is not replaced automatically.']},
      {id:'deferred-tools',title:'A smaller launch surface',paragraphs:['Plugins is removed from Settings; Integrations remains available. Computer Use, Dictation, and Emulators & environments are shown as Coming soon without launch controls.']},
    ],related:['workspace-activity','interface-languages','local-frondose','saved-passwords-more-chat-agents'],
  },
  {
    id:'workspace-activity',group:'workspace',
    title:'Workspace activity',
    description:'See what changed in this workspace and choose when to share that history.',
    appLink:{view:'settings',id:'workspace-activity',label:'Open Workspace activity'},
    sections:[
      {id:'recorded-actions',title:'What Frondose records',paragraphs:['Settings → Workspace activity shows recent saves, directory links, Git commits and confirmed pushes made through Frondose, planning and document changes, published updates, and session events. Records stay on this device and in the originating workspace. The list shows up to 60 events; older events roll off after 30 days or as local storage caps are reached. Recording starts with this build and does not backfill past actions.']},
      {id:'not-recorded',title:'What it does not record',paragraphs:['File entries use relative paths, not file content. The activity log does not capture unsaved drafts, prompts, replies, passwords, terminal commands or output, or arbitrary activity outside Frondose. For example, a commit or push run directly in a terminal is not automatically detected. An automation dispatch means its session opened, not that its AI task succeeded.']},
      {id:'share-history',title:'Use history as agent context',paragraphs:['In AI Sessions → Chat, choose Add recent activity, review the preview and add it to an unsent message. Use Review and send to choose whether to send that message to the provider. In Automations, opt in individually to attach recent activity to future scheduled runs. Review the grant before enabling the schedule. Activity does not itself trigger any automation and does not grant new permissions.']},
    ],related:['ai-sessions','local-automations'],
  },
  {
    id:'saved-passwords-more-chat-agents',group:'updates',date:'2026-11-14',
    title:'Saved passwords, more Chat agents & Codex usage',
    description:'Bring saved logins into Browser, chat with more installed agents, and read Codex allowance from the same installation as Terminal.',
    sections:[
      {id:'saved-logins',title:'Import and use saved logins',paragraphs:['In Browser, open Import browser data and choose Saved passwords. Select a supported macOS Chromium profile or a password CSV, review the sites, and confirm. Frondose puts the selected logins in a workspace vault encrypted with operating system storage. Use the key button on a matching HTTPS sign-in page to fill a login without submitting the form, or remove the saved login from Frondose. Cookie import remains a separate option. Bookmarks, browsing history, and passkeys are not imported.']},
      {id:'more-agents',title:'Chat with Pi or Oh My Pi',paragraphs:['Select an installed Pi or Oh My Pi CLI in Settings → CLI Agents → Open AI Sessions → Chat to use the same composer and transcript as Codex and Claude Code. These modes accept messages and resume their own conversations without enabling file or command tools. For the full CLI experience use Terminal; the desktop-app shortcuts remain separate.']},
      {id:'codex-usage',title:'Find the installed Codex allowance',paragraphs:['The status bar now finds Codex using the same local installation search as Terminal, including supported macOS app bundles. It shows the remaining allowance only for quota windows the signed-in CLI returns. Refresh the status bar after signing in through the CLI if no ChatGPT allowance is available.']},
      {id:'simpler-navigation-and-integrations',title:'A smaller New Tab chooser and clearer integration setup',paragraphs:['New Tab keeps the everyday Terminal, Markdown, Browser and Text editor actions. The other launcher entries are removed without closing existing tabs or deleting data. Open AI Sessions from CLI Agents in Settings. In Settings → Integrations, each provider now opens to an overview and setup guide before asking for credentials. Bitbucket scans accessible workspaces for repositories, and Linear and Jira reads exclude finished issues.']},
    ],related:['browser-import-agent-modes','local-frondose','ai-sessions'],
  },
  {
    id:'browser-import-agent-modes',group:'updates',date:'2026-11-14',
    title:'Browser import and AI session modes',
    description:'Bring selected website sign-ins into Browser and choose how to open your AI tools.',
    sections:[
      {id:'import',title:'Import selected website sign-ins',paragraphs:['Browser can preview cookies from supported Mac browser profiles and desktop cookie exports. Confirm the source and choose which sites to copy into the current workspace. Frondose keeps cookie values in its desktop process and leaves the original browser and other workspaces unchanged. Passwords, bookmarks, and history are not imported. Some sites need a fresh sign-in.']},
      {id:'agent-modes',title:'Choose Chat, Terminal, or Desktop apps',paragraphs:['Codex and Claude Code share the same in-app Chat controls. Installed terminal agents are available in Terminal, including those without Chat support. Open supported official apps from Desktop apps on macOS. They open in their own windows and keep their own accounts and chat histories.']},
    ],related:['local-frondose','ai-sessions'],
  },
  {
    id: 'version-specific-release-review', group: 'updates', date: '2026-11-14',
    title: 'Release notes for every build',
    description: 'What’s New shows the changes for the version you installed.',
    sections: [
      {id:'read-this-release', title:'See what changed in 0.1.7', paragraphs:['See what changed now takes you to the changes for the open release instead of launching the same workspace tour. Go to Docs opens the matching article. The onboarding tour remains a separate workflow.']},
      {id:'past-updates', title:'Find changes from earlier versions', paragraphs:['The notes for 0.1.4, 0.1.5, and 0.1.6 are now in the changelog. Existing What’s New tabs for those builds can show the newly bundled notes. A build without matching notes never borrows an older release’s article.', 'Open Help → Full changelog to browse previous releases by date. Each versioned article includes its version above the title, so it’s clear which build you’re reading even when several release tabs are open. Reading an article doesn’t install an update.']},
    ], related: ['centered-update-progress','right-corner-update-notices','local-mac-build-updates'],
  },
  {
    id: 'centered-update-progress', group: 'updates', date: '2026-11-13',
    title: 'A simpler update screen',
    description: 'A centered progress bar and a shorter update popup.',
    sections: [
      {id:'centered-progress', title:'See update progress at a glance', paragraphs:['The full-window update screen shows a large centered title, the version below it, a thicker progress bar, the current step, and Minimize. Release notes and Docs links are kept out of the progress screen.']},
      {id:'shorter-popups', title:'Less text in the corner', paragraphs:['The update offer no longer repeats the restart safety message. Draft and session checks still run. The onboarding completion popup also moves to the bottom right.', 'Use Release notes from the offer if you want to review the build before clicking Update. The currently running version draws the progress screen; an older build may show the old layout while installing this release.']},
    ], related: ['right-corner-update-notices','local-frondose'],
  },
  {
    id: 'right-corner-update-notices', group: 'updates', date: '2026-11-12',
    title: 'Update notices on the right',
    description: 'Find the update offer and minimized progress in the bottom-right corner.',
    sections: [
      {id:'right-corner', title:'A consistent corner for updates', paragraphs:['The update offer and minimized progress now stay on the bottom right, with smaller insets in narrow windows.']},
      {id:'minimize', title:'Minimize without cancelling', paragraphs:['The progress screen keeps the update status separate from release review. Click Minimize to collapse it or click the corner status to open it again. This does not cancel installation or bypass the readiness checks.', 'To look for an offer manually, open Settings → App updates. Once an update is ready, review its notes or click Update. If installation is waiting for active work, finish that work and try again.']},
    ], related: ['local-mac-build-updates','local-frondose'],
  },
  {
    id: 'review-update-cleanup', group: 'updates', date: '2026-11-15',
    title: 'Review and close update blockers',
    description: 'Close reviewed terminals and unused Browser pages together, without starting the update.',
    sections: [
      {id:'review-the-list', title:'Review the items first', paragraphs:['If an update is waiting, choose Review items to close. The review lists the Frondose-owned terminals and unused blank Browser pages that Frondose can close for you. Secure any unfinished work before choosing Close all listed items. Stopping a terminal ends its running process; Cancel closes nothing. If the list changes, review it again before confirming.']},
      {id:'finish-the-update', title:'Check the items that remain', paragraphs:['Cleanup leaves unsaved files, settings edits, loaded webpages, other windows and work it cannot verify untouched. The updater refreshes the blocker list after cleanup. Finish the remaining items yourself, then choose Install now. Closing reviewed items never installs the update or restarts the app by itself.']},
    ], related: ['clearer-update-blockers', 'local-mac-build-updates'],
  },
  {
    id: 'clearer-update-blockers', group: 'updates', date: '2026-11-15',
    title: 'See what is blocking an update',
    description: 'Find the sessions, tabs and drafts to finish before retrying.',
    sections: [
      {id:'before-you-update', title:'Before you update', paragraphs:['If an update is waiting, read the list under Before you update. A running terminal shows its name, workspace and project when available, even if it is in a different workspace. Hiding a terminal or switching workspaces doesn’t stop it. Return to its workspace and use the session’s Stop control when you no longer need it. Save a listed draft, close a listed Browser tab after saving its work, or let listed work finish.']},
      {id:'retry-update', title:'Return to your work and try again', paragraphs:['Minimize the update to return to the workspace. Open the update again and choose Try again to refresh the list or install when everything is clear. Checking or retrying never stops a terminal or discards a draft.']},
    ], related: ['local-mac-build-updates', 'review-update-cleanup'],
  },
  {
    id: 'local-mac-build-updates', group: 'updates', date: '2026-11-12',
    title: 'Install local Mac builds in Frondose',
    description: 'Use the Update button for verified, owner-staged Mac builds.',
    sections: [
      {id:'install-local', title:'Update and reopen from the app', paragraphs:['Frondose can detect a newer verified local Mac build. Before it installs and reopens, it checks for unfinished work. The previous app and a workspace backup are kept for recovery. This channel does not require a public update feed.']},
      {id:'check-install', title:'Review a staged build', paragraphs:['A local offer appears only after the owner stages a newer compatible build. If you don’t see it, open Settings → App updates and click Check for updates. Save drafts and finish active terminal work before clicking Update. The updater won’t stop a separately started local server, so close that server yourself and open the packaged app normally before trying again.']},
    ], related: ['local-frondose', 'clearer-update-blockers'],
  },
  {
    "id": "editor-checklists-direct-drops",
    "group": "updates",
    "title": "Rich writing, checklists & direct drops",
    "description": "November 7: richer editing and a clearer, more direct local workspace.",
    "sections": [
      {
        "id": "writing",
        "title": "Write visually, save safely",
        "paragraphs": [
          "Docs and supported Markdown/TXT files share visual Write mode, slash blocks, inline formatting and autosave for existing saved content. New files and documents still require their first explicit save. Source remains available; unsupported Markdown stays there rather than being silently rewritten. Opening Write does not itself change content.",
          "Autosave pauses for stale or changed disk content, unavailable files and pending saves. A database Document and a disk file have different storage and backup paths. Conflicting writes preserve your draft for review."
        ]
      },
      {
        "id": "tasks",
        "title": "Finish tasks without archiving them",
        "paragraphs": [
          "To-do details now include a saved checklist and references to individual items or scoped Area tabs. Hover a card for its finish checkmark, or right-click for Open, status, priority, Copy prompt and Archive. Successful completion has a brief ash-particle effect, disabled by reduced motion. Finished To Do is distinct from Archived; completion retains the task’s priority, resources and Area membership."
        ]
      },
      {
        "id": "workspace",
        "title": "Fewer interruptions, clearer controls",
        "paragraphs": [
          "Vertical tabs keep their action buttons in a horizontal row. Drag a grouped view header back onto the tab bar to detach it without restarting its backing tool. File drops insert a quoted file path rather than file contents; other supported references resolve current saved context directly into the draft. No drop presses Enter. Changed targets/input and unsafe multiline paste are rejected without a modal preview.",
          "Terminal and browser right-click menus expose ordinary local controls. Quick Commands has bounded label-first search adapted from licensed Orca code, searchable saved text, Copy, Insert and explicit Run/Send. The Runs navigation page is retired without deleting history. Neutral white accents, padded fields and spaced footer buttons replace the previous purple accent and touching controls. Docs section links scroll smoothly unless reduced motion is enabled."
        ]
      }
    ],
    "related": [
      "local-frondose",
      "navigation"
    ]
  },
  {
    "id": "resources-and-area-updates",
    "group": "updates",
    "title": "Linked resources & Area updates",
    "description": "November 6: richer task references and updates where the work lives.",
    "sections": [
      {
        "id": "resources",
        "title": "Use real saved resources",
        "paragraphs": [
          "To-do Related resources can select actual Area Resources records, not only pasted web links. Selected-Area tasks can link resources from those Areas only; multiple selected Areas form a union. All Areas and No Areas stay inside the current workspace. Removed, archived or foreign resources are rejected again when saved or exported as context.",
          "A task can hold multiple resources. Finder files are copied into private local storage with bounded size; safe links, text, comments and Frondose references can also be dropped. The original file is not moved. Uploaded resource bytes are not included in the workspace JSON export, so keep original files or download them separately."
        ]
      },
      {
        "id": "updates",
        "title": "Publish to an Area or project",
        "paragraphs": [
          "Areas have their own Updates feed and composer, while project Updates remain project-scoped. A private draft is not a published update. Publishing retains attribution, version checks, threaded replies and reactions; it does not start an AI, submit code or publish a product release. These notes describe local development changes, not a public hosted release or remote delivery service."
        ]
      }
    ],
    "related": [
      "local-frondose",
      "navigation"
    ]
  },
  {
    "id": "shared-area-task-status",
    "group": "updates",
    "title": "Shared tasks, independent status",
    "description": "November 3: one task across selected Areas, without mixing status and priority.",
    "sections": [
      {
        "id": "status",
        "title": "Keep priority and progress separate",
        "paragraphs": [
          "Priority expresses urgency and importance; status is either In Progress or Finished. New tasks start In Progress. Moving between priority columns changes only priority, and moving between state rows changes only status. A finished task retains its priority. These are saved local task fields, not claims that an AI verified the outcome.",
          "Choose No Areas, one or more Selected Areas, or dynamic All Areas. Every selected Area shows the same task identity, so edits are shared rather than copied into disconnected cards. All Areas includes future Areas in this workspace; no task leaks into another workspace."
        ]
      },
      {
        "id": "reliability",
        "title": "Protect saved work",
        "paragraphs": [
          "Workspace and Area boards use the same compact headings, search and version-checked task operations. Stale edits fail instead of overwriting newer changes. Shared task persistence and independent priority/status were checked in the packaged Mac build. This milestone records that local validation; it does not certify Windows, Linux, remote collaboration or provider account access."
        ]
      }
    ],
    "related": [
      "local-frondose",
      "navigation"
    ]
  },
  {
    "id": "task-board-block-writing",
    "group": "updates",
    "title": "To Do List & block writing",
    "description": "November 2: a simple priority board, resource picker and visual Markdown blocks.",
    "sections": [
      {
        "id": "board",
        "title": "Plan work in four priorities",
        "paragraphs": [
          "To Do List adds four color-labeled priority columns and horizontal progress/completion lanes. Task details keep the title, description, separate AI prompt, dates, Area membership, Lead AI metadata and multiple resource references together. Search finds task text and resource labels. Choosing a Lead AI does not launch or authenticate it.",
          "The workspace board and Area boards are scoped local views, not separate databases. Archive is recoverable. Dropping saved files or references into Related resources adds an entry to the draft, and Save to-do commits those references. Resource links do not grant new filesystem or workspace access."
        ]
      },
      {
        "id": "editor",
        "title": "Write Markdown as blocks",
        "paragraphs": [
          "The initial Write editor adds headings, bullet and numbered lists, checklists, quotes, code blocks, dividers and tables through a slash menu and block controls. Source and Preview remain available. Supported rich edits normalize Markdown formatting rather than promising byte-for-byte preservation. Unsupported constructs stay in Source. Later November 7 notes cover the added inline controls and guarded autosave."
        ]
      }
    ],
    "related": [
      "local-frondose",
      "navigation"
    ]
  },
  {
    "id": "browser-setup-local-polish",
    "group": "updates",
    "title": "Browser, CLI setup & workspace polish",
    "description": "November 1: reliable local discovery, browser search and clearer workspace setup.",
    "sections": [
      {
        "id": "browser",
        "title": "Browse addresses or search",
        "paragraphs": [
          "Browser opens an isolated Chromium tab with URL/search input, Back, Forward and Reload. Ordinary search words go to search rather than becoming a broken HTTPS host. Localhost uses HTTP by default. Local paths and embedded credentials are never sent to search. This is not your installed Chrome or Firefox profile, and embedded pages do not receive Frondose’s private application bridge."
        ]
      },
      {
        "id": "setup",
        "title": "Detect tools and finish setup",
        "paragraphs": [
          "CLI detection reuses bounded Orca filesystem lookup and adds verified known Codex Mac app locations. Detection checks executables, not account access or model entitlement, and never runs shell startup files or installs tools. Workspace Onboarding Checklist records actual actions or explicit skips; CLI Agents settings changes future explicit launches only.",
          "Comment Copy context uses a trusted write-only native clipboard bridge with manual-copy fallback. Settings shares the compact workspace navigation width and row rhythm; Docs folders animate with reduced-motion support. Provider allowance defaults to Remaining, converting the number and meter together. These are recorded local changes, not public OS/provider certification."
        ]
      }
    ],
    "related": [
      "local-frondose",
      "navigation"
    ]
  },
  {
    "id": "workspace-navigation-refinements",
    "group": "updates",
    "title": "Workspace navigation refinements",
    "description": "October 31: simpler Projects, useful new-tab actions and clearer desktop presentation.",
    "sections": [
      {
        "id": "navigation",
        "title": "Keep navigation local and predictable",
        "paragraphs": [
          "Projects lists only projects in the current workspace as simple rows; it does not combine every workspace or treat worktrees as projects. Right-clicking New tab exposes supported creation actions and detected CLI choices. Opening the menu does not start work. Existing drafts and native tool sessions remain protected when changing views.",
          "File-type glyphs use a shared neutral visual language. The Explorer’s open and close motion retains its tree, and disclosures respect keyboard access and reduced motion. Language access opens its actual Settings page without translating user files, comments, terminal output or embedded apps."
        ]
      },
      {
        "id": "presentation",
        "title": "Keep authored copy and controls consistent",
        "paragraphs": [
          "Authored recurrence and status labels are capitalized without changing their saved identifiers. Automation recipes use Frondose-specific examples and retain explicit schedule enablement, fresh directory/Route checks and paid-use disclosure. What’s New reuses Docs reading width and section typography. Later dated notes describe the subsequent Browser, setup, task-board and editor additions; this entry does not backdate those later capabilities."
        ]
      }
    ],
    "related": [
      "local-frondose",
      "navigation"
    ]
  },
  {
    "id": "rich-writing",
    "group": "workspace",
    "title": "Write and autosave in Docs",
    "description": "Use the visual editor without losing source syntax or a conflicting draft.",
    "related": [
      "files-search",
      "review-notes",
      "to-do-list"
    ],
    "sections": [
      {
        "id": "modes",
        "title": "Choose the right mode",
        "paragraphs": [
          "Write is the visual Markdown editor for in-app Docs, not a separate kind of document or an AI command. Use slash at the start of a block for headings, lists, checklists, quotes, code, tables and dividers. Select text for bold, italic, inline code or a safe link. Source edits literal Markdown; Preview reads the same draft without running arbitrary HTML.",
          "Rich editing normalizes Markdown formatting. Unsupported dialects, front matter, raw HTML, images and other unhandled constructs remain in Source so opening Write does not silently erase them. Workspace files such as Markdown, code and plain text use manual Save."
        ]
      },
      {
        "id": "saving",
        "title": "Understand what autosaves",
        "paragraphs": [
          "Existing in-app Docs have guarded autosave. Opening an editor without editing does not write. A new document needs an explicit first Create or Save. Workspace files only write to disk when you choose Save.",
          "Document writes carry their expected updated timestamp, and file saves verify the disk and directory-binding version. Stale writes keep your draft instead of overwriting newer changes. Save important drafts before quitting."
        ]
      }
    ]
  },
  {
    "id": "quick-commands",
    "group": "workspace",
    "title": "Quick Commands",
    "description": "Keep reusable commands or prompts close to an explicit terminal target.",
    "related": [
      "terminals",
      "navigation"
    ],
    "sections": [
      {
        "id": "library",
        "title": "Save and find reusable text",
        "paragraphs": [
          "Right-click a terminal or its tab and choose Quick Commands. Saved entries belong to the current workspace host or project, not a globally shared provider account. Add a name and command or prompt; Edit and Delete affect the saved entry only. Saving never runs it. Search uses bounded, case-insensitive label-first ranking adapted from licensed Orca code, with command-body matches ranked afterward.",
          "Arrow Down from search focuses the first available action. Copy puts the saved text on the clipboard. Cmd/Ctrl+Enter in the edit form saves the entry rather than executing it. There are no silently installed example scripts, automatic starts, imported remote-host grants or provider credentials in this library."
        ]
      },
      {
        "id": "insert",
        "title": "Insert is different from Run or Send",
        "paragraphs": [
          "Insert adds single-line text to the selected running terminal without Enter. Multiline Insert is disabled because raw terminal newlines can execute commands. Run explicitly submits to a shell with your OS permissions. Send explicitly submits to an AI CLI and may incur provider charges. Inspect the target and displayed text before either action.",
          "The saved library is not an execution permission grant. Existing terminal status, ownership and backend input checks still apply. Switching or restoring a tab does not replay a saved command. Do not store secrets in reusable prompts, and keep a separate backup of important command definitions."
        ]
      }
    ]
  },
  {
    "id": "todo-resource-links",
    "group": "workspace",
    "title": "To-do resources & checklist",
    "description": "Attach the right references and break a task into smaller checks.",
    "related": [
      "to-do-list",
      "rich-writing"
    ],
    "sections": [
      {
        "id": "checklist",
        "title": "Track steps inside a task",
        "paragraphs": [
          "Open a to-do and use Add checklist item. Each item has its own text and completion checkbox; progress appears on the card. Save to-do commits checklist edits with the rest of the task. Checking every sub-item does not automatically finish the parent: use its finish checkmark or status control after reviewing the result.",
          "Hover a task for Mark as Finished, or right-click for Open, status changes, priority, Copy prompt and Archive. Completion and archiving are different. Finished tasks keep their checklist, priority, resources and Area assignment; Finished To Do shows completed work and permits moving it back to In Progress. Reduced motion disables the ash-particle effect."
        ]
      },
      {
        "id": "links",
        "title": "Attach multiple scoped resources",
        "paragraphs": [
          "Related resources accepts Finder files, safe HTTP(S) URLs, bounded text, saved comments, files, tasks, Area Resources and Frondose item/tab references. Each supported drop appends another entry; Add resource browses saved choices. An Area’s whole Routes, Projects, Resources, Documents, Updates or To Do List tab can be linked as a scoped collection rather than a copy of its current contents.",
          "Selected-Area tasks can use resources owned by those Areas only. Changing membership never silently deletes an incompatible link: remove it or include its Area before saving. The service checks scope again during save and context export. Limit attachments to 20 references per task, 25 MB per Finder file and 250 MB of local workspace upload storage. Uploaded bytes are not included in workspace JSON backups."
        ]
      },
      {
        "id": "drops",
        "title": "Use a reference in a suitable input",
        "paragraphs": [
          "A file drop into a terminal inserts its quoted absolute path, not the full file. Comments and tasks resolve fresh saved text; drops insert a draft only and never press Enter. Multiline text needs the terminal’s safe bracketed-paste mode. Input typed while the reference is loading, a changed target or a stale directory cancels insertion. There is no context-preview modal.",
          "Group docking and reference insertion are different gestures: terminal center drops add a reference, while pane-edge drops arrange tabs. Drag a grouped view header to the tab bar to detach it. Browser guests and arbitrary native application inputs do not share Frondose’s private drag token; supported ordinary text inputs can accept reference text, not new authority or uploaded image bytes."
        ]
      }
    ]
  }
];
