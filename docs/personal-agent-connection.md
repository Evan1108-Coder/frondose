# Choose Talvori’s AI connection

Talvori does not automatically use the first connected AI account. Open the
Talvori tab, select a verified account under **AI connection**, and save setup.
The same preferences are available in Settings → Talvori. An older saved Codex
default does not count as an explicit selection: choose and save it once.

Only verified, ready accounts are offered for a new selection. A selected
account that disconnects remains identified as needing reconnection; Talvori
never silently switches to a different account. Clear the selection with
**Not selected**. This does not disconnect the provider or delete profiles,
conversations, scheduled definitions, or history. Existing personal-agent
launches—including scheduled dispatch—must still match the saved selection.
Ordinary agent profiles keep their independent, explicitly selected accounts.

The Talvori tab contains identity, connection and context preferences plus
Activity and Scheduled. Conversations is the single place to chat. Opening
Talvori never creates a conversation or starts AI work. **Open conversation**
opens existing work when possible; **New conversation** explicitly creates a
new draft. Source/mention entry points keep their exact addressed agent and
source IDs. A draft is not sent until the person explicitly sends it.

## Agent identity and pictures

Agent Studio → select an agent → Edit allows a name and optional picture. Use
Choose image or drag one PNG, JPEG or WebP onto the image field, then crop and
save. The crop is a bounded 512-pixel raster; stored data is limited to 250 KB.
SVG files and external picture URLs are not accepted. Remove returns to the
provider mark or Talvori orb. The underlying provider and connection remain
visible separately: a custom picture does not change the execution account.

Profile picture/name edits create a new immutable profile version. Existing
run versions and manually authored instructions remain intact. Portable agent
definition copies continue to omit connection authority and profile pictures;
full content-only workspace archives retain the validated image without
restoring account credentials or run authority.

Provider marks are contained within their avatar rather than filling its
outer circle. Sidebar icon slots use their own fixed size so expanding or
collapsing the sidebar cannot crop the larger avatar geometry.
