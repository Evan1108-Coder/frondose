import test from 'node:test';
import assert from 'node:assert/strict';
import { DOC_CONNECTIONS } from '../src/lib/docs-connections.js';
import { CONNECTION_PREVIEWS } from '../src/lib/connection-previews.js';
import { CONNECTOR_CATALOG } from '../server/connectors/catalog.mjs';
import { articleText } from '../src/lib/docs-utils.js';

test('every connection has substantial illustrated setup, operation and recovery documentation', () => {
  const expected = ['codex', 'claude', ...Object.keys(CONNECTOR_CATALOG)].sort();
  const guides = DOC_CONNECTIONS.filter(article => article.connectionProvider);
  assert.deepEqual(guides.map(article => article.connectionProvider).sort(), expected);
  for (const article of guides) {
    assert.ok(articleText(article).split(/\s+/).length >= 400, `${article.id}: substantial guide`);
    assert.ok(article.sections.some(section => section.id === 'connect'));
    assert.ok(article.sections.some(section => section.id === 'recovery'));
    assert.equal(CONNECTION_PREVIEWS[article.connectionProvider].length, 2);
    assert.ok(article.sources.length > 0);
    for (const source of article.sources) {
      assert.equal(new URL(source.url).protocol, 'https:');
      assert.ok(source.label.length > 5);
    }
  }
});

test('provider guides disclose actual auth and content boundaries', () => {
  const text = id => articleText(DOC_CONNECTIONS.find(article => article.id === `connection-${id}`));
  assert.match(text('slack'), /HTTPS/);
  assert.match(text('slack'), /15-message/);
  assert.match(text('slack'), /thread_ts/);
  assert.match(text('slack'), /15 messages per page/);
  assert.match(text('google-drive'), /not recursive/);
  assert.match(text('google-sheets'), /A1:Z200/);
  assert.match(text('github-packages'), /ecosystem/);
  assert.match(text('figma'), /team IDs and project: discovery are not supported/);
  assert.match(text('jira'), /must not collect customer API tokens/);
  assert.match(text('claude'), /not a general-purpose editing/);
  assert.match(text('codex'), /not proof of sole agent authorship/);
  assert.match(text('github'), /stale-head/);
});
