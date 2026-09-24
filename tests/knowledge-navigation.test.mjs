import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Knowledge deep links open the right record and remove an unavailable linked editor', () => {
  const source = readFileSync(new URL('../src/views/Library.jsx', import.meta.url), 'utf8');
  assert.match(source, /knowledge_entries[^\n]+row\.id === selectedId/);
  assert.match(source, /context_snapshots[^\n]+row\.id === selectedId/);
  assert.match(source, /setEditor\(\{ kind: linkedKind, item: linkedKnowledge \|\| linkedContext \}\)/);
  assert.match(source, /else if \(selectedId\) setEditor\(null\)/);
  assert.match(source, /if \(linkedKind\) navigate\('library', null, \{ projectId: page\.projectId \}\)/);
});
