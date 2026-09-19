import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DOC_GROUPS, DOC_ARTICLES } from '../src/lib/docs-content.js';
import { articleMarkdown, articleText, searchDocs } from '../src/lib/docs-utils.js';
import { pageHash, parsePage } from '../src/lib/navigation.js';

test('documentation has unique, navigable articles and valid related links', () => {
  assert.ok(DOC_ARTICLES.length >= 100);
  const ids = new Set(DOC_ARTICLES.map(a => a.id));
  assert.equal(ids.size, DOC_ARTICLES.length);
  for (const article of DOC_ARTICLES) {
    assert.ok(DOC_GROUPS.some(g => g.id === article.group), article.id);
    assert.equal(parsePage(pageHash('docs', article.id)).id, article.id);
    assert.ok(article.sections.length >= 2, article.id);
    assert.equal(new Set(article.sections.map(s => s.id)).size, article.sections.length, article.id);
    assert.ok(articleText(article).split(/\s+/).length >= 100, `${article.id} should be substantive`);
    for (const related of article.related ?? []) assert.ok(ids.has(related), `${article.id}: ${related}`);
    if (article.image) for (const theme of ['light','dark']) assert.ok(existsSync(new URL(`../public/docs/${article.image}-${theme}.png`, import.meta.url)), article.id);
    if (article.appLink) assert.equal(parsePage(pageHash(article.appLink.view, article.appLink.id ?? null)).view, article.appLink.view);
  }
  for (const group of DOC_GROUPS) assert.ok(DOC_ARTICLES.some(a => a.group === group.id));
});
test('full-text docs search finds steps, ranks titles, and handles no matches', () => {
  assert.equal(searchDocs(DOC_ARTICLES, '').length, DOC_ARTICLES.length);
  assert.equal(searchDocs(DOC_ARTICLES, 'totallynonexistentword').length, 0);
  assert.ok(searchDocs(DOC_ARTICLES, 'permissions').length > 1);
  assert.equal(searchDocs(DOC_ARTICLES, 'GitHub')[0].title.includes('GitHub'), true);
  assert.ok(searchDocs(DOC_ARTICLES, 'APPROVAL').length > 0);
});
test('copy page produces readable complete Markdown', () => {
  const article = DOC_ARTICLES.find(a => a.id === 'projects');
  const md = articleMarkdown(article);
  assert.ok(md.startsWith('# Projects\n\n'));
  for (const section of article.sections) assert.ok(md.includes(`## ${section.title}`));
});
