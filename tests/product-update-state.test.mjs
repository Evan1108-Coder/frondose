import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishedProductUpdates, recentProductUpdates, PRODUCT_UPDATES } from '../src/lib/product-updates.js';
import { normalizeProductUpdateReads, productUpdateScope, readProductUpdateReads, recordProductUpdateRead, unreadProductUpdate } from '../src/lib/product-update-state.js';
import { DOC_ARTICLES } from '../src/lib/docs-content.js';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const date = new Date('2026-10-24T12:00:00Z');
test('release ordering excludes unpublished, impossible and missing dates without mutating input', () => {
  const entries = [{ id: 'future', date: '2030-01-01' }, { id: 'older', date: '2026-10-19' }, { id: 'invalid', date: '2026-02-31' }, { id: 'newer', date: '2026-10-24' }, { id: 'absent' }];
  assert.deepEqual(publishedProductUpdates(entries, date).map(item => item.id), ['newer', 'older']);
  assert.equal(entries[0].id, 'future');
  assert.deepEqual(recentProductUpdates(PRODUCT_UPDATES, new Date('2026-10-20')).map(item => item.id), ['initial-launch']);
  assert.deepEqual(recentProductUpdates(PRODUCT_UPDATES, new Date('invalid')), []);
});
test('read state is versioned, bounded and separate for each actor and workspace', () => {
  const browser = storage(), a = productUpdateScope('account.a', 'workspace.a'), b = productUpdateScope('account.b', 'workspace.a'), c = productUpdateScope('account.a', 'workspace.b');
  assert.notEqual(a, b); assert.notEqual(a, c);
  assert.notEqual(productUpdateScope('a.b', 'c'), productUpdateScope('a', 'b.c'));
  assert.equal(productUpdateScope(null, 'workspace.a'), null);
  recordProductUpdateRead(browser, a, 'your-agents-library');
  assert.deepEqual(readProductUpdateReads(browser, a).read, ['your-agents-library']);
  assert.deepEqual(readProductUpdateReads(browser, b).read, []);
  assert.deepEqual(readProductUpdateReads(browser, c).read, []);
  assert.equal(normalizeProductUpdateReads({ version: 1, read: Array.from({ length: 100 }, (_, index) => `${index}`) }).read.length, 64);
  assert.deepEqual(normalizeProductUpdateReads({ version: 2, read: ['wrong'] }).read, []);
});
test('only the newest valid release announces; dismissing it does not cycle older unread releases', () => {
  const updates = recentProductUpdates(PRODUCT_UPDATES, date), browser = storage(), key = productUpdateScope('local', 'workspace.a');
  assert.equal(unreadProductUpdate(updates, readProductUpdateReads(browser, key), DOC_ARTICLES)?.id, 'your-agents-library');
  assert.deepEqual(readProductUpdateReads(browser, key).read, [], 'opening/rendering does not write a receipt');
  const receipt = recordProductUpdateRead(browser, key, 'your-agents-library');
  assert.equal(unreadProductUpdate(updates, receipt, DOC_ARTICLES), null);
  assert.equal(unreadProductUpdate([{ id: 'missing', articleId: 'not-authored' }], receipt, DOC_ARTICLES), null);
});
test('corrupt or unavailable browser storage cannot break reading', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readProductUpdateReads(broken, 'key').read, []);
  assert.deepEqual(recordProductUpdateRead(broken, 'key', 'opened').read, ['opened']);
  assert.deepEqual(normalizeProductUpdateReads({ version: 1, read: [null, '', {}, 'ok', 'ok', 'x'.repeat(129)] }).read, ['ok']);
});
test('release popup reads authored Docs content without navigating until Go to Docs', () => {
  const help = readFileSync(new URL('../src/components/HelpMenu.jsx', import.meta.url), 'utf8');
  const reader = readFileSync(new URL('../src/components/ReleaseReader.jsx', import.meta.url), 'utf8');
  assert.match(help, /const openRelease = update => setRelease/);
  assert.match(help, /onOpenDocs=\{\(\) =>/);
  assert.match(reader, /<DocsArticleSections article=\{article\}/);
  assert.match(reader, /Go to Docs/);
  assert.doesNotMatch(reader, /apiRequest|fetch\(|navigate\(/);
});
