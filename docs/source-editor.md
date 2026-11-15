# Source editor and file changes

Frondose edits UTF-8 text files from the workspace directory in a native
CodeMirror 6 editor. Line numbers, code folding, syntax colours, selection,
undo/redo, indent/outdent and in-file find operate locally. JavaScript,
TypeScript, JSX/TSX, JSON, CSS, HTML, Markdown, Python and SQL have bundled
language parsers. Other text files remain editable as plain text. Syntax
colouring is display support, not a compiler or language-server diagnostic.

The **Code appearance** Settings apply the same fonts, palettes, size, line
height, tab width, line numbers and wrapping to editable source and change
previews. Focusing source displays a caret and active-line shading, not a
purple outline around the entire editor. Keyboard focus remains visible on
toolbar, search and menu controls. Source scrolling is owned by the editor;
ordinary React rerenders do not restore an old scroll offset.

Markdown retains **Source** and safe **Preview** views. Formatting tools stay
near the caret/selection, and ordinary list Enter continues or exits a list.
The source remains Markdown; preview does not load remote image pixels.

## Recent and Blame

The toolbar has **Code** and a **Changes** menu. The latter opens on hover,
click or keyboard, offering:

- **Recent**: compares content versions actually observed in this app. Its
  Settings interval defaults to ten minutes and can be changed from one minute
  to one day. Tracking begins only when Frondose opens a readable file. It
  includes unsaved editor changes, but does not watch external disk edits or
  reconstruct edits made before tracking. The comparison names the real
  observation time and says when coverage is shorter than the interval.
  Source snapshots stay in bounded app memory, never localStorage, and are
  discarded on reload or eviction. The preview is capped at 1,200 lines.
- **Blame**: disabled until the directory is explicitly connected to GitHub
  in Frondose. It reads committed **HEAD** attribution from local Git, with no
  network call and no upstream mutation. It is not attribution for unsaved
  edits or the working copy. The server rechecks the exact workspace/root and
  repository versions; a stale or unavailable file shows an error, not old
  blame reused as current.

## Selection handoff and comments

Select source and use its drag handle, or drag selected text, into an AI CLI.
The context gesture carries a one-use proof and an exact inclusive line range;
the user reviews a bounded context draft before insertion. Frondose does not
press Enter, start an agent or treat source text as execution authority.

For a saved file selection of up to 4,000 characters, **Comment** opens an
anchored discussion. Save dirty/new files first. Inline review notes
supports replies, reactions and resolved discussions, retaining the original
quote if a file changes. AI mentions stay text; an explicit drag/copy handoff
is required for a CLI to review a discussion.

Saving still requires the current directory epoch and file version. A failed
or stale save retains the draft. Binary/unsupported files offer an explicit
bounded read-only raw preview and cannot be overwritten through that preview.

See `/licenses/code-editor.txt` for CodeMirror/Lezer dependency notices.

## Optional branch tab layouts

**Remember file and page tabs per branch** is off by default and applies only
to this workspace on this device. Off means a branch switch refreshes the file
tree and clean file previews without replacing current tabs. On remembers
clean file/page layouts for returning to a branch; a first visit creates an
empty New tab alongside globally retained work.

Terminals, AI CLIs, browser tabs, draft files and mixed splits containing them
keep their identities across branches. This setting never stops, resumes or
launches a process. If an editor becomes dirty or pending during a branch
operation, Frondose keeps all tabs rather than replacing the layout. Saved
metadata is bounded to twelve branches across three physical-repository scopes;
it contains relative file references and app routes, not file contents,
credentials, commands or launch/resume intent. Restored files get fresh editor
identities and the newly verified directory epoch. A replaced directory or
different workspace/project/repository cannot restore another scope's layout.

**Forget saved branch tab layouts** removes only that preference metadata.
Current tabs, files, drafts and running work remain untouched. Failed or
uncertain branch operations refresh metadata but never restore a branch layout.
