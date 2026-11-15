import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSync } from 'esbuild';
import { acceptDirectorySave, createDirectoryDraft, directoryApiPath, directoryDraftDirty, discardDirectoryDraft } from '../src/lib/directory-drafts.js';

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bundle = buildSync({ stdin: { contents: `export {DirectoryBindingDialog, DirectoryExplorer, DirectoryFileEditor} from './src/components/workspace/DirectoryFiles.jsx'; export {AppContext} from './src/app-context.js'; export {DocumentContent} from './src/components/DocumentContent.jsx';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const { DirectoryBindingDialog, DirectoryExplorer, DirectoryFileEditor, AppContext, DocumentContent } = module.exports;
const app = { workspace: { id: 'ws', name: 'Example' }, data: { projects: [] } };
const render = (Component, props) => renderToStaticMarkup(React.createElement(AppContext.Provider, { value: app }, React.createElement(Component, props)));
const newTab = { id: 'tab1', entityId: 'file1', path: 'notes.md', draft: true };

test('source viewport restores only on a stable editor attachment, never each scroll-triggered render', () => {
  const editor = source('src/components/workspace/DirectoryFiles.jsx');
  assert.match(editor, /const attachEditor = useCallback\(element =>/);
  assert.match(editor, /ref=\{attachEditor\}/);
  assert.doesNotMatch(editor, /state\.current = draft/);
  assert.doesNotMatch(editor, /element\.scrollTop = draft\.scrollTop/);
  const attach = editor.slice(editor.indexOf('const attachEditor'), editor.indexOf('const alive'));
  assert.match(attach, /current\.scrollTop/); assert.match(attach, /\}, \[\]\)/);
  const code = source('src/components/workspace/SourceCodeEditor.jsx');
  assert.equal((code.match(/new EditorView\(/g) || []).length, 1);
  assert.match(code, /Creation and cleanup only/);
  assert.match(code, /if \(previous !== value\).*sourceReplacement/);
  assert.doesNotMatch(code, /useEffect\([^]*scrollTop\s*=.*\[value\]/);
});

test('directory binding offers an explicit project/directory confirmation, not fake OS UI', () => {
  const html = render(DirectoryBindingDialog, { workspaceId: 'ws', onClose() {}, onBound() {} });
  assert.match(html, /Workspace directory/); assert.match(html, /Project name/); assert.match(html, /Use this directory for this workspace/);
  assert.match(html, /type="checkbox"/); assert.match(html, /Link directory/);
  assert.match(html, /Existing records and folders stay where they are/);
  assert.match(html, /folder picker/); assert.doesNotMatch(html, /Allow Notifications|Full Disk Access|System Settings/);
});

test('unbound explorer does not fabricate a file listing', () => {
  const html = render(DirectoryExplorer, { workspaceId: 'ws', binding: null, onOpenFile() {}, onBind() {} });
  assert.match(html, /Choose directory/); assert.match(html, /project directory to browse files/);
  assert.doesNotMatch(html, /README\.md|package\.json|Find files/);
});

test('bound explorer has Names/Contents search and a real refresh action', () => {
  const html = render(DirectoryExplorer, { workspaceId: 'ws', binding: { path: '/example/project', version: '1' }, onOpenFile() {}, onBind() {} });
  assert.match(html, /role="tablist" aria-label="File search mode"/);
  assert.match(html, /aria-selected="true"[^>]*>Names/); assert.match(html, />Contents</);
  assert.match(html, /Find files by name/); assert.match(html, /Refresh files/); assert.match(html, /Opening files/);
});

test('new Markdown source is an escaped controlled draft and starts unsaved', () => {
  const draft = {...createDirectoryDraft('ws',newTab),mode:'source',content:'<script>alert(1)</script>'};
  const html = render(DirectoryFileEditor, { workspaceId: 'ws', tab: newTab, drafts: new Map([['file1',draft]]) });
  assert.match(html, /New Markdown file path/); assert.match(html, /aria-label="Markdown view"/);
  assert.match(html, />Source</); assert.match(html, />Preview</); assert.match(html, /Unsaved changes/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /data-field-defaults-exclude="true"/);
});

test('Markdown preview shares the retained draft and does not load remote images or favicons', () => {
  const draft = { ...createDirectoryDraft('ws', newTab), mode: 'preview', content: '# Draft title\n\n![tracking](https://tracker.invalid/pixel.png)\n\n[Remote](https://unknown-host.invalid/page)\n\n<script>alert(1)</script>' };
  const html = render(DirectoryFileEditor, { workspaceId: 'ws', tab: newTab, drafts: new Map([['file1', draft]]) });
  assert.match(html, /Draft title/); assert.match(html, /\[Image: tracking\]/); assert.match(html, /href="https:\/\/unknown-host.invalid\/page"/);
  assert.doesNotMatch(html, /<img|<iframe|<script>|favicon/);
});

test('DocumentContent safe-preview switch keeps external links without loading service icons', () => {
  const html = render(DocumentContent, { content: '[Example](https://example.invalid) ![Image](https://image.invalid/a.png)', showLinkIcons: false });
  assert.match(html, /href="https:\/\/example.invalid\/"/); assert.match(html, /rel="noreferrer noopener"/);
  assert.doesNotMatch(html, /<img|inline-service-logo/);
});

test('drafts restore the same workspace content and do not leak across workspaces', () => {
  const draft = { ...createDirectoryDraft('ws', newTab), content: 'Retained draft', baseline: 'Disk baseline', loaded: true, isNew: false, version: 'v1' };
  assert.equal(directoryDraftDirty(draft), true);
  assert.equal(createDirectoryDraft('ws', newTab, draft).content, 'Retained draft');
  assert.equal(createDirectoryDraft('other', newTab, draft).content, '');
  assert.equal(draft.content, 'Retained draft');
});

test('successful save updates the disk baseline but preserves a newer local edit', () => {
  const sent = { ...createDirectoryDraft('ws', newTab), content: 'Sent text', revision: 1 };
  const saved = { path: 'notes.md', content: 'Sent text', version: 'v2' };
  const accepted = acceptDirectorySave(sent, saved, sent);
  assert.equal(accepted.isNew, false); assert.equal(accepted.version, 'v2'); assert.equal(directoryDraftDirty(accepted), false);
  const later = acceptDirectorySave({ ...sent, content: 'Newer local edit', revision: 2 }, saved, sent);
  assert.equal(later.content, 'Newer local edit'); assert.equal(later.baseline, 'Sent text'); assert.equal(directoryDraftDirty(later), true);
});

test('discard is explicit and does not pretend a new file was saved', () => {
  const created = createDirectoryDraft('ws', newTab);
  assert.equal(directoryDraftDirty(created), true);
  const discarded = discardDirectoryDraft({ ...created, content: 'unsaved' });
  assert.equal(directoryDraftDirty(discarded), false); assert.equal(discarded.isNew, true); assert.equal(discarded.version, null);
  const existing = discardDirectoryDraft({ ...created, content: 'draft', baseline: 'disk', isNew: false });
  assert.equal(existing.content, 'disk'); assert.equal(directoryDraftDirty(existing), false);
});

test('directory request URLs encode workspace IDs and literal file paths', () => {
  const url = new URL(directoryApiPath('ws&a', 'file', { path: '中文/a b.md' }), 'http://127.0.0.1');
  assert.equal(url.pathname, '/api/directory-workspace/file'); assert.equal(url.searchParams.get('workspace_id'), 'ws&a'); assert.equal(url.searchParams.get('path'), '中文/a b.md');
});

test('file UI exposes pending/dirty guards and only sends explicit versioned saves', () => {
  const jsx = source('src/components/workspace/DirectoryFiles.jsx');
  assert.match(jsx, /isDirty: \(\) => directoryDraftDirty\(state.current\)/);
  assert.match(jsx, /isPending: \(\) => state.current.pending/);
  assert.match(jsx, /if \(savePromise.current\) return savePromise.current/);
  assert.match(jsx, /'file', \{ path: state.current.path, expected_binding_version: tab.rootVersion \}/);
  assert.match(jsx, /const checked = await external.beforeSave\(sent\)/);
  assert.match(jsx, /expected_version: checked.version, expected_binding_version: tab.rootVersion, confirmed: true/);
  assert.match(jsx, /catch \(error\) \{ update\(value => \(\{ \.\.\.value, error \}\)\); return false/);
  assert.match(jsx, /savedCallback.current\?\.\(\{ path: result.path \}\)/);
});

test('explorer cancels old scope/search requests and the layout supports narrow screens', () => {
  const jsx = source('src/components/workspace/DirectoryFiles.jsx'), css = source('src/components/workspace/directory-files.css');
  assert.match(jsx, /controller.abort\(\)/); assert.match(jsx, /expectedScope === scope.current/); assert.match(jsx, /epoch === generation.current/);
  assert.match(jsx, /Symbolic links are not opened/); assert.match(jsx, /revealDirectory/);
  assert.match(css, /@media \(max-width: 680px\)/); assert.match(css, /prefers-reduced-motion/); assert.match(css, /forced-colors/);
});
