import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOC_GROUPS, DOC_ARTICLES } from '../src/lib/docs-content.js';
import { PRODUCT_UPDATES } from '../src/lib/product-updates.js';
import { DOC_ARTICLE_ICONS } from '../src/lib/docs-icons.js';
import { localDocsCatalog } from '../src/lib/local-docs-catalog.js';
import { articleText, docsArticlesInNavigationOrder, searchDocs } from '../src/lib/docs-utils.js';

const localData = { meta: { product: { edition: 'local' } } };
const catalog = () => localDocsCatalog(DOC_GROUPS, DOC_ARTICLES, localData);

test('Docs uses the latest authored release first without reordering other guides', () => {
  const { articles } = catalog();
  const before = articles.map(article => article.id);
  const ordered = docsArticlesInNavigationOrder(articles, PRODUCT_UPDATES);
  const updates = ordered.filter(article => article.group === 'updates').map(article => article.id);
  const known = new Set(updates);
  const expected = PRODUCT_UPDATES.map(row => row.articleId).filter(id => known.has(id));
  assert.deepEqual(updates.slice(0, expected.length), expected);
  assert.equal(updates[0], PRODUCT_UPDATES[0].articleId);
  assert.deepEqual(ordered.filter(article => article.group !== 'updates'), articles.filter(article => article.group !== 'updates'));
  assert.deepEqual(articles.map(article => article.id), before);
});

test('non-local documentation retains the historical catalog by reference', () => {
  const result = localDocsCatalog(DOC_GROUPS, DOC_ARTICLES, {});
  assert.equal(result.groups, DOC_GROUPS);
  assert.equal(result.articles, DOC_ARTICLES);
});

test('local browsing and search hide removed products without deleting originals', () => {
  const before = JSON.stringify({ groups: DOC_GROUPS, articles: DOC_ARTICLES });
  const { groups, articles } = catalog();
  const ids = new Set(articles.map(article => article.id));
  for (const id of ['provider-connections', 'computer-connections', 'computer-agent-settings', 'chat-basics', 'agent-actions', 'home-focus', 'scheduled-work']) assert.equal(ids.has(id), false, id);
  for (const id of ['governance', 'chats-agents', 'workbench', 'integrations', 'developers', 'workflows']) assert.equal(groups.some(group => group.id === id), false, id);
  assert.ok(ids.has('local-cli-workspace'));
  assert.equal(searchDocs(articles, 'ACP').length, 0);
  assert.equal(JSON.stringify({ groups: DOC_GROUPS, articles: DOC_ARTICLES }), before);
  assert.ok(DOC_ARTICLES.some(article => article.id === 'provider-connections'));
});

test('local entrypoints have substantive valid articles and no obsolete app destinations', () => {
  const { groups, articles } = catalog();
  const ids = new Set(articles.map(article => article.id));
  assert.equal(ids.size, articles.length);
  const removed = new Set(['agents', 'connections', 'chats', 'workbench', 'overview', 'inbox', 'today']);
  for (const article of articles) {
    assert.ok(groups.some(group => group.id === article.group), article.id);
    assert.ok(DOC_ARTICLE_ICONS[article.id], article.id);
    assert.ok(article.sections.length >= 2, article.id);
    if (article.comingSoon) assert.match(article.description, /^Coming soon\. Not available in this release\./, article.id);
    assert.ok(articleText(article).split(/\s+/).length >= (article.comingSoon ? 35 : 100), article.id);
    assert.equal(new Set(article.sections.map(section => section.id)).size, article.sections.length, article.id);
    assert.equal(removed.has(article.appLink?.view), false, article.id);
    for (const related of article.related ?? []) assert.ok(ids.has(related), `${article.id}: ${related}`);
    assert.equal(article.connectionProvider, undefined, article.id);
    assert.equal(article.runnerProvider, undefined, article.id);
    assert.equal(article.image, undefined, article.id);
  }
});

test('local guide separates discovery, authentication, drafts, and native lifetime', () => {
  const articles = catalog().articles;
  const introduction = articleText(articles.find(article => article.id === 'local-frondose'));
  assert.match(introduction, /one directory/i);
  assert.match(introduction, /Detection is not authentication/);
  assert.match(introduction, /not a sandbox/);
  assert.match(introduction, /does not import or synchronize/);
  assert.match(introduction, /Settings and Docs are separate screens/);
  const files = articleText(articles.find(article => article.id === 'files-search'));
  assert.match(files, /directory-binding versions/);
  assert.match(files, /keeps your draft/);
  assert.match(files, /does not execute arbitrary HTML or load remote images/);
  assert.match(articleText(articles.find(article => article.id === 'terminals')), /Closing a pane or tab can detach the view or stop/);
});

test('current local guides describe direct home launch, guarded native history, browser URLs and actual GitHub boundaries', () => {
  const articles = catalog().articles, text = id => articleText(articles.find(article => article.id === id));
  const terminals = text('terminals');
  assert.match(terminals, /no extra ordinary launch confirmation form/);
  assert.match(terminals, /OS home/);assert.match(terminals,/Codex and Claude Code JSONL/);
  assert.match(terminals, /All local sessions needs separate permission/);
  assert.match(terminals, /Multiline Insert is disabled/);
  assert.doesNotMatch(terminals, /Review the launch controls/);
  assert.match(text('navigation'), /AI CLI chat is protected/);
  assert.match(text('navigation'), /up to eight views/);assert.match(text('navigation'), /one focused pane/);
  assert.match(text('files-search'), /editable URL bar/);assert.match(text('files-search'), /loopback addresses default to HTTP/);
  assert.match(text('projects'), /Projects on GitHub link/);
  assert.match(text('notifications'), /fourth onboarding step automatically/);assert.match(text('notifications'), /does not prove a visible banner/);
  assert.match(text('preferences'), /separate workspace home-terminal host/);
  const release = text('local-cli-workspace');
  assert.match(release, /Terminal opens directly/);assert.match(release, /archived Codex sessions/);
  assert.match(release, /update download\/install scheduler remains separate work/);
});

test('all legacy runtime guide links resolve to honest CLI basics, not adapter execution claims', () => {
  const originals = DOC_ARTICLES.filter(article => article.id.startsWith('computer-') && article.runnerProvider);
  assert.ok(originals.length > 0);
  const articles = catalog().articles;
  for (const original of originals) {
    const guide = articles.find(article => article.id === original.id);
    assert.ok(guide, original.id);
    assert.equal(guide.group, 'local-clis');
    assert.equal(guide.localWorkspaceGuide, true);
    assert.equal(guide.runnerProvider, undefined);
    const text = articleText(guide);
    assert.match(text, /historical setup-guide entry is not proof/);
    assert.match(text, /does not import or synchronize/);
    assert.match(text, /Discovery does not verify authentication/);
    assert.doesNotMatch(text, /ACP|pairing|47|44/);
  }
});

test('Docs renders the selected local article and uses the same filtered catalog for search', () => {
  const source = readFileSync(new URL('../src/views/Docs.jsx', import.meta.url), 'utf8');
  assert.match(source, /function DocsScreenshot\(\{ name, theme, caption, article \}\)/);
  assert.match(source, /<DocsScreenshot article=\{article\}/);
  assert.doesNotMatch(source, /const article = DOC_ARTICLES\.find\(item => item\.id === page\.id\);\s*if \(article\?\.connectionProvider/);
  assert.match(source, /useMemo\(\(\) => localDocsCatalog/);
  assert.match(source, /searchDocs\(DOC_ARTICLES, query\)/);
  assert.match(source, /DOC_GROUPS\.some\(item => item\.id === 'developers'\)/);
});
