import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalD } from 'morphicons/dom';
import { DOC_ARTICLES } from '../src/lib/docs-content.js';
import { DOC_ARTICLE_ICONS } from '../src/lib/docs-icons.js';

test('every documentation article has its own distinct semantic icon geometry', () => {
  assert.deepEqual(Object.keys(DOC_ARTICLE_ICONS).sort(), DOC_ARTICLES.map(a => a.id).sort());
  const names = new Set(), shapes = new Set();
  for (const article of DOC_ARTICLES) {
    const { iconName, iconNode } = DOC_ARTICLE_ICONS[article.id];
    assert.ok(Array.isArray(iconNode), article.id);
    const shape = canonicalD(iconNode);
    assert.ok(shape.length > 3, article.id);
    assert.ok(!names.has(iconName), 'Repeated icon name: ' + article.id);
    assert.ok(!shapes.has(shape), 'Repeated icon geometry: ' + article.id);
    names.add(iconName);
    shapes.add(shape);
  }
});
