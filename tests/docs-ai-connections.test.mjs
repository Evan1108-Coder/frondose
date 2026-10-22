import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNNER_PROVIDER_CATALOG } from '../src/lib/runner-provider-catalog.js';
import { API_PROVIDERS } from '../src/lib/ai-provider-catalog.js';
import { DOC_RUNNER_CONNECTIONS, DOC_API_CONNECTIONS, RUNNER_SETUP_NOTES, DOC_COMPUTER_CONNECTIONS } from '../src/lib/docs-ai-connections.js';
import { DOC_ARTICLES } from '../src/lib/docs-content.js';
import { articleMarkdown, articleText, searchDocs } from '../src/lib/docs-utils.js';

test('every computer runtime has authored setup, pinned provenance, provider links and limits', () => {
  assert.equal(DOC_RUNNER_CONNECTIONS.length, RUNNER_PROVIDER_CATALOG.length);
  assert.deepEqual(Object.keys(RUNNER_SETUP_NOTES).sort(), RUNNER_PROVIDER_CATALOG.map(provider => provider.id).sort());
  assert.equal(new Set(Object.values(RUNNER_SETUP_NOTES)).size, RUNNER_PROVIDER_CATALOG.length);
  for (const provider of RUNNER_PROVIDER_CATALOG) {
    const guide = DOC_RUNNER_CONNECTIONS.find(article => article.runnerProvider === provider.id);
    assert.ok(DOC_ARTICLES.includes(guide));
    assert.ok(RUNNER_SETUP_NOTES[provider.id].length >= 160, provider.id);
    const text = articleText(guide);
    assert.ok(text.includes(provider.launchTemplate.join(' ')), provider.id);
    assert.ok(text.includes(provider.sourceRevision), provider.id);
    assert.match(text, /OS account|OS tools|OS actions|operating-system/i, provider.id);
    assert.match(text, /not.*automatic|not automatically|not.*imports/i, provider.id);
    assert.equal(guide.sources[0].url, provider.installLink);
    assert.equal(guide.sources[1].url, provider.sourceUrl);
    for (const source of guide.sources) assert.equal(new URL(source.url).protocol, 'https:');
    assert.ok(articleMarkdown(guide).includes(provider.installLink));
    assert.ok(searchDocs([guide], provider.title).includes(guide));
  }
});

test('every direct API provider has a complete credential guide with correct console links', () => {
  assert.equal(DOC_API_CONNECTIONS.length, API_PROVIDERS.length);
  for (const provider of API_PROVIDERS) {
    const guide = DOC_API_CONNECTIONS.find(article => article.apiProvider === provider.id);
    assert.equal(guide.appLink.id, provider.id);
    assert.equal(guide.sources[1].url, provider.keyUrl);
    assert.match(articleText(guide), /Saving neither sends a prompt nor verifies inference/);
    assert.match(articleText(guide), /each user connects their own/);
    assert.match(articleText(guide), /explicit model|exact model/i);
  }
});

test('computer guidance distinguishes local consent, account rights, fresh turns and website history', () => {
  const text = DOC_COMPUTER_CONNECTIONS.map(articleText).join('\n');
  for (const phrase of ['Windows', 'macOS', 'Linux', '22.17', 'fresh provider turns', 'Claude.ai', 'ChatGPT', 'not inside a Frondose tenant sandbox', 'not silently replayed', 'subscription rules']) assert.ok(text.includes(phrase), phrase);
});
