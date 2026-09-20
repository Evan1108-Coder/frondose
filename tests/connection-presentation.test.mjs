import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTOR_CATALOG } from '../server/connectors/catalog.mjs';
import { CONNECTION_PRESENTATION, connectionPresentation } from '../src/lib/connection-presentation.js';
import { DOC_ARTICLES } from '../src/lib/docs-content.js';
import { serviceBrand } from '../src/lib/service-brands.js';

test('every shipped connection has distinct presentation, two workflows, a brand and valid guide', () => {
  const ids = ['codex', 'claude', ...Object.keys(CONNECTOR_CATALOG)];
  assert.equal(ids.length, 14);
  assert.deepEqual(Object.keys(CONNECTION_PRESENTATION).sort(), ids.sort());
  const descriptions = new Set();
  for (const id of ids) {
    const content = connectionPresentation({ id });
    assert.ok(content.description.length > 30, id);
    assert.ok(content.overview.length > 80, id);
    assert.ok(content.boundary.length > 60, id);
    descriptions.add(content.description);
    assert.equal(content.flows.length, 2, id);
    for (const flow of content.flows) for (const key of ['source', 'destination', 'detail', 'icon']) assert.ok(flow[key], `${id}:${key}`);
    assert.ok(serviceBrand(id)?.src, `${id} needs a bundled brand`);
    assert.ok(DOC_ARTICLES.some(article => article.id === (content.guide ?? `connection-${id}`)), `${id} guide`);
  }
  assert.equal(descriptions.size, ids.length);
});

test('unknown future providers get an honest fallback without invented capability claims', () => {
  const content = connectionPresentation({ id: 'future', name: 'Future', resource_hint: 'Select specific files.' });
  assert.equal(content.description, 'Select specific files.');
  assert.equal(content.guide, 'integration-roadmap');
  assert.match(content.boundary, /Only the capabilities listed/);
});
