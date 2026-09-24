import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../src/components/CapturedRunContext.jsx', import.meta.url), 'utf8');

test('captured context opens from run details and performs only a bounded GET', () => {
  assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', format: 'esm' }));
  const work = readFileSync(new URL('../src/views/Work.jsx', import.meta.url), 'utf8');
  assert.match(work, /<CapturedRunContextButton run=\{run\} \/>/);
  assert.match(source, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(source, /apiRequest\(`\/api\/runs\/\$\{encodeURIComponent\(run.id\)\}\/context`, \{ signal: controller.signal \}\)/);
  assert.doesNotMatch(source, /method:|startRun|startSession|rumboActions|context\/inspect/);
  assert.match(source, /return \(\) => controller.abort\(\)/);
});

test('historical captures fail closed when absent, mismatched or access-revoked', () => {
  assert.match(source, /result\?\.run_id !== run.id/);
  assert.match(source, /context_not_recorded/);
  assert.match(source, /Rumbo will not reconstruct one and present it as historical evidence/);
  assert.match(source, /context_access_revoked/);
  assert.match(source, /saved prompt and source content are withheld/);
  assert.match(source, /setState\(\{ loading: false, result: null, error \}\)/);
  assert.doesNotMatch(source, /sourceAccess|\.request|JSON\.stringify\(result/);
});

test('capture view distinguishes exact Rumbo prompt from provider and later tool context', () => {
  assert.match(source, /Exact saved Rumbo-supplied prompt/);
  assert.match(source, /Provider-owned system instructions and internal context are not visible/);
  assert.match(source, /not a complete transcript of those tool reads/);
  assert.match(source, /No token count is estimated/);
  assert.match(source, /runtime_protocol_included === true/);
  assert.match(source, /source.status !== 'excluded'/);
  assert.match(source, /source\.version/);
  assert.match(source, /source\.content_hash/);
  assert.match(source, /<pre tabIndex=\{0\}/);
});
