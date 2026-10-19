import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const work = readFileSync(new URL('../src/views/Work.jsx', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../src/views/Chats.jsx', import.meta.url), 'utf8');

test('context integration compiles without changing simulation or note execution paths', () => {
  assert.doesNotThrow(() => transformSync(work, { loader: 'jsx', format: 'esm' }));
  assert.doesNotThrow(() => transformSync(chats, { loader: 'jsx', format: 'esm' }));
  assert.match(work, /mode === "live" \? \{ context_inspection_id:/);
  assert.match(chats, /recipient === 'note' \? await talvoriActions\.createMessage/);
  assert.match(chats, /metadata: \{ delivery: 'note'/);
});

test('new live sessions require explicit current and unexpired context review before launch', () => {
  assert.match(work, /mode === "live" && !contextReady/);
  assert.match(work, /reviewedContext\?\.key === inspectionKey && Date\.parse\(reviewedContext\.result\.expires_at\) > Date\.now\(\)/);
  assert.match(work, /context_inspection_id: reviewedContext\.result\.id/);
  assert.match(work, /onReviewed=\{result => setReviewedContext\(\{ key: inspectionKey, result \}\)\}/);
  assert.match(work, /onInvalidated=\{\(\) => setReviewedContext\(null\)\}/);
  assert.match(work, /!readiness.canStartLive \|\| !cwd \|\| !contextReady/);
});

test('chat inspections and sends share exact normalized instruction and attachment inputs', () => {
  assert.match(chats, /prompt: composer\.text\.trim\(\) \|\| 'Shared attachments'/);
  assert.match(chats, /attachments: sentAttachments/);
  assert.match(chats, /const sentFiles = sentAttachments/);
  assert.match(chats, /content: text, attachments: sentFiles, agent_id: recipient/);
  assert.match(chats, /if \(agent && !recoveringTurn && !contextReady && \(composer.permission === 'workspace-write' \|\| composer.nativeTools === true\)\)/);
  assert.match(chats, /prepareExplicitChatSend/);
  assert.match(chats, /context_inspection_id: captured\.id/);
  assert.match(chats, /agent\?\.version \?\? null/);
  assert.match(chats, /val\(agent, 'permission_policy'\) === 'read-only'/);
  assert.match(chats, /composer\.memory && val\(agent, 'memory_policy'\) !== 'none'/);
});

test('uncertain chat delivery retains original idempotency key but definite rejections require fresh review', () => {
  assert.match(chats, /if \(recipient !== 'note' && !composer\.turn\) composer\.turn = crypto\.randomUUID\(\)/);
  assert.match(chats, /client_turn_id: composer\.turn/);
  assert.match(chats, /if \(cause.status && cause.status < 500\) \{ composer.turn = null;/);
  assert.match(chats, /Retry delivery checks the same turn without duplicating work/);
  assert.match(chats, /const recoveringTurn = Boolean\(composer.turn\)/);
});

test('retry controls prepare a reviewed attempt instead of launching when the retry dialog opens', () => {
  const preparation = chats.slice(chats.indexOf('function retry(message, run)'), chats.indexOf('async function retryReviewed'));
  assert.match(preparation, /setRetryDraft\(\{ message, run \}\)/);
  assert.doesNotMatch(preparation, /sendChatTurn/);
  assert.match(chats, /if \(!retryDraft \|\| !retryContextReady\)/);
  assert.match(chats, /context_inspection_id: reviewedRetry\.result\.id/);
  assert.match(chats, /source_message_id: retryDraft.message.id/);
  assert.match(chats, /onClick=\{retryReviewed\}/);
});
