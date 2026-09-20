import test from 'node:test';
import assert from 'node:assert/strict';
import { DOC_ARTICLES } from '../src/lib/docs-content.js';
import { articleMarkdown, articleText, searchDocs } from '../src/lib/docs-utils.js';
import { UPDATE_TYPES, UPDATE_HEALTH } from '../src/lib/activity.js';

const guide = id => DOC_ARTICLES.find(article => article.id === id);

test('Updates guides cover the implemented lifecycle with navigable substantive instructions', () => {
  for (const id of ['updates-replies', 'project-updates']) {
    const article = guide(id), text = articleText(article);
    assert.ok(text.split(/\s+/).length >= 650, `${id}: explain the workflow beyond a summary`);
    assert.equal(article.appLink.view, 'updates');
    assert.ok(article.image, `${id}: reuse an available project-context visual`);
    for (const topic of ['draft', 'publish', 'title', 'health', 'Reply', 'reaction', 'history', 'archive', 'restore', '#/updates', 'access', 'export']) assert.ok(text.toLowerCase().includes(topic.toLowerCase()), `${id}: ${topic}`);
    assert.doesNotMatch(text, /Milestones & updates stores|connects selected projects/);
    assert.match(text, /does not|never/);
    assert.match(text, /Private drafts are excluded from workspace exports/);
    assert.match(text, /reactions are not restored/i);
    assert.match(text, /author editing privileges/);
    assert.match(text, /IDs remapped/);
    const markdown = articleMarkdown(article);
    for (const section of article.sections) assert.ok(markdown.includes(`## ${section.title}`));
  }
});

test('Updates reference describes the shared type and health catalogs without claiming automatic effects', () => {
  const text = articleText(guide('updates-replies'));
  for (const [, label] of [...UPDATE_TYPES, ...UPDATE_HEALTH]) assert.ok(text.includes(label), label);
  assert.match(text, /Only the original human author can edit/);
  assert.match(text, /Private draft text is excluded from published revision history/);
  assert.match(text, /Replies publish directly/);
  assert.match(text, /does not.*complete a Route/);
  assert.match(text, /does not contact Codex, Claude/);
  assert.match(text, /cannot become a private draft again/);
});

test('project guidance links to the fuller discussion guide and is discoverable by draft and health workflows', () => {
  assert.ok(guide('project-updates').related.includes('updates-replies'));
  assert.ok(guide('updates-replies').related.includes('project-updates'));
  const ids = new Set(searchDocs(DOC_ARTICLES, 'draft').map(article => article.id));
  assert.ok(ids.has('project-updates')); assert.ok(ids.has('updates-replies'));
  assert.ok(guide('project-updates').sections.find(section => section.id === 'write').steps.length >= 5);
  assert.match(articleText(guide('project-updates')), /does not automatically change project health/);
});
