# AI connections, Plugins, and personal navigation

This guide describes the current local Talvori build, not a proposed public launch. A connected account and a usable agent are different things. Talvori's local API is loopback-only and must not be exposed publicly as-is.

## AI connections

Open **AI connections** and choose a provider from the table. Each row opens a detail page first. Reading that page does not authorize, run a model, or spend credits. The detail explains the sign-in route, whose account limits apply, what Talvori can currently do, and what it cannot do.

| Provider | Current route | Current boundary |
| --- | --- | --- |
| OpenRouter | Browser authorization for a per-user, per-workspace key | Reviewed conversations and scheduled agent prompts with an explicit model; supported final-reply action proposals require review. No native/file tools or streaming; real-account compatibility unverified. |
| Hugging Face Inference | Browser OAuth after the Talvori operator registers an app | Same reviewed completion/action-proposal path after configuration; no native/file tools or streaming. Real-account compatibility unverified. |
| GitHub Copilot | Planned browser OAuth and hosted SDK | Coming soon; no working Talvori authorization or execution. |
| Codex | Already-installed, signed-in local CLI | Existing local runner for reviewed requests. This is not public-site access to a visitor's ChatGPT subscription. |
| Claude Code | Already-installed, signed-in local CLI | Existing local runner with current capability restrictions. Not public-site subscription OAuth. |

Direct OpenAI, Anthropic, Gemini, and other model APIs require provider credentials and separate implementation. Talvori does not present an API-key field as browser sign-in. A successful account check proves only that particular authorization; a successful model test proves only that request. Neither grants an agent new workspace permissions.

## Plugins

**Plugins** is the new name for non-AI service integrations and lives in Settings. The entries are **Coming soon**. Their detail pages preview intended capabilities, but the local API blocks new authorization, resource reads, sync, imports, and provider writes. Existing records are preserved. A past “Connected” record is not evidence that a Plugin works today.

The Playbooks builder is retired, with its stored records retained as inert history. Ask Talvori for supported local workspace-action proposals and review them before applying or scheduling one. A future external Plugin action still needs a specific release decision, operator app registration, resource and permission checks, and live verification before it can become runnable.

## Header shortcuts and pinned dock

Go to **Settings → Appearance & navigation → Header quick access** to choose up to eight page shortcuts. Pinned tabs and starred entities are independent of those choices. Use **Customize sidebar** to pin a tab without creating a second sidebar group; starred entities are pinned from their own item controls.

By default, pinned entries appear in the top header. Turn off **Show pinned tabs in header** to move them to a floating dock. Drag the dock by its grip; moving it near the left or right edge changes it into a vertical strip. The grip is keyboard-operable: arrow keys move it, Shift+arrow moves farther, and Home returns it to the bottom. Its placement is personal to this browser and workspace. If nothing is pinned, there is no empty dock.

New browser/workspace preferences use the **Focused** sidebar. Today, Talvori, Starred, Inbox, and Projects are its root destinations; other pages remain available through More, search, and Sidebar customization. Existing saved layouts are preserved until their owner changes them. A hidden tab is not deleted.

## Motion and accessibility

Page and popup transitions are brief, directional, and reduced when either the operating system or Talvori's **Reduce motion** preference requests it. The sidebar has a barely perceptible gradient; it is not intended to carry content or signal status. The main and Settings sidebar borders can be dragged to resize, collapsed, and temporarily revealed by hovering at the left edge. Resizing does not change permissions or navigate by itself.
