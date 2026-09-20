import test from 'node:test';
import assert from 'node:assert/strict';
import { DOC_ARTICLES } from '../src/lib/docs-content.js';
import { articleText, articleMarkdown, searchDocs } from '../src/lib/docs-utils.js';

const guide = id => DOC_ARTICLES.find(article => article.id === id);

test('existing Routes guide explains the actual child lifecycle without introducing a duplicate guide', () => {
  const article = guide('routes'), text = articleText(article);
  assert.ok(text.split(/\s+/).length > 800);
  assert.equal(article.appLink.view, 'tasks'); assert.equal(article.image, 'projects');
  for (const label of ['New sub-route', 'Attach existing route', 'Change parent', 'Detach from parent', 'Show archived sub-routes', 'Retry same request', 'Repair by detaching this route']) assert.ok(text.includes(label), label);
  for (const boundary of [/five levels including the root/, /100 immediate children/, /same project and team/, /starts in Backlog/, /copied acceptance checkboxes start unchecked/i, /does not launch agents/, /does not.*Done automatically/, /Permanent deletion.*blocked/]) assert.match(text, boundary);
  assert.ok(article.related.includes('route-agreements'));
  for (const section of article.sections) assert.ok(articleMarkdown(article).includes(`## ${section.title}`));
});

test('hierarchy guidance separates containment, prerequisites, permissions, acceptance and publication', () => {
  const text = articleText(guide('route-agreements'));
  assert.ok(text.split(/\s+/).length > 550);
  for (const boundary of [/same workspace, project, and team/, /dependency expresses a prerequisite/, /cycle.*rejected/, /unfinished.*archived/, /never completes the parent automatically/, /does not publish the same entry on the parent/, /Mentions do not contact or activate an agent/]) assert.match(text, boundary);
});

test('project and goal guides describe structural leaf progress and honest incomplete context', () => {
  for (const id of ['routes', 'milestones-timeline', 'goals']) {
    const text = articleText(guide(id));
    assert.match(text, /leaf/i); assert.match(text, /cancelled/i); assert.match(text, /archived/); assert.match(text, /restricted/i);
  }
  assert.match(articleText(guide('goals')), /not weighted by effort or importance/);
  const results = searchDocs(DOC_ARTICLES, 'sub-route').map(article => article.id);
  assert.ok(results.includes('routes')); assert.ok(results.includes('route-agreements'));
});
