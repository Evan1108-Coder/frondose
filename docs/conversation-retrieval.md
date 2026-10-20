# Reuse a past conversation

Open a conversation, choose **Select context sources**, and use **Past
conversations**. Type a phrase and activate **Search messages** (or Enter).
Search is lexical text matching in this workspace; it does not call a model,
start work, search ChatGPT/Claude account history, or automatically read every
conversation. SQLite's built-in case folding is ASCII-only; non-ASCII text is
matched literally rather than claiming language-aware search.

Search shows up to 20 readable matches from the 500 most recent matching
messages. It omits the current chat, archived chats, inaccessible parents, and
agent replies whose captured sources are no longer readable. The preview is
bounded to 400 characters. Restricted matches and their counts are not exposed.

Select individual messages, optionally combine them with documents, memory
notes, or Context Packs, then choose **Snapshot … sources**. Selection contains
canonical IDs, not client-supplied source text. Frondose resolves the canonical
full message at snapshot creation; it does not copy attachments or adjacent
messages. Up to 20 explicit sources can be selected; a full snapshot over 15 KB
is rejected, not silently truncated. Source text is untrusted reference data.

The immutable snapshot can be inspected in the composer. It becomes part of
the exact captured context only on explicit Send or a separately confirmed
schedule. Searching, selecting, and saving a snapshot never contact a provider.
The same snapshot attachment validation protects ordinary sends and schedules.
Modified contents, filenames, markers, chats, or workspace IDs are rejected.

Current permissions and historical source ancestry are checked during search,
snapshot creation, snapshot loading, context inspection, delivery, and reads of
derived history. A readable container does not make a restricted agent reply
readable. Editing a source does not rewrite an old snapshot; moving it does not
erase its old permission boundary. Revocation makes the snapshot unavailable.

Browser draft storage keeps only the snapshot ID, not protected source text,
source titles, or search results. Restoring a draft reloads the canonical snapshot
under current access and blocks sending until it is available. Legacy draft
snapshots are migrated to an ID-only reference on use. Ordinary user-authored
draft text and uploaded draft files retain their existing local persistence.

This is explicit retrieval, not autonomous cross-chat memory. Approved agent
memory remains a separate store with its own Include saved memory choice and
human-reviewed save/forget controls. Provider-native search tools remain
restricted to the sources captured for that run.

Agent memories copied from a provider run now retain that run's captured source
lineage too. Read access to the agent cannot bypass revoked access to the source
document or conversation. A legacy derived memory whose source run has no
verifiable context capture is unavailable rather than being treated as ordinary
unprotected text; independently authored notes with no source-run claim are
unaffected.
