import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { FEEDBACK_WIRE_LIMIT, feedbackEmail } from '../src/lib/feedback-report.js';
import { createDesktopReportService } from '../desktop/report-service.mjs';
import { createReportWorker } from '../worker/report-worker.js';

const id = '9e65b9ee-2025-466b-ac21-2ac57ba02876';
const env = {
  FEEDBACK_ENABLED: 'true', RESEND_API_KEY: 'fixture-only',
  FEEDBACK_PER_IP: { async limit() { return { success: true }; } },
  FEEDBACK_GLOBAL: { async limit() { return { success: true }; } },
};
const post = (body, headers = {}) => new Request('https://forms.frondose.com/report',
  { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.1', ...headers }, body, duplex: 'half' });
function payload(email) {
  const form = new FormData();
  form.set('message', 'Example report 🪴');
  form.set('requestId', id);
  if (email !== undefined) form.set('email', email);
  return form;
}
const receipt = () => Response.json({ id: 'test-delivery' });

test('normalizes one optional Reply-To address and refuses extra recipients or newlines', () => {
  assert.equal(feedbackEmail(' ada+feedback@example.com '), 'ada+feedback@example.com');
  assert.equal(feedbackEmail('  '), '');
  for (const email of ['ada', 'ada@example', 'ada@example.com,bob@example.com', 'Ada <ada@example.com>', 'ada@example.com\r\nCc: bob@example.com']) {
    assert.equal(feedbackEmail(email), null, email);
  }
});

test('Worker fixes From and To, sets Reply-To only when present, and relays file bytes', async () => {
  const sent = [];
  const worker = createReportWorker({ fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(request.headers.Authorization, 'Bearer fixture-only');
    assert.equal(request.headers['Idempotency-Key'], 'frondose-feedback/' + id);
    assert.equal(request.redirect, 'error');
    sent.push(JSON.parse(request.body));
    return receipt();
  } });
  const form = payload('ada@example.com');
  form.set('from', 'not-us@example.com');
  form.set('to', 'not-support@example.com');
  form.append('attachments', new Blob([new Uint8Array([0, 1, 254])]), 'example.png');
  assert.equal((await worker.fetch(post(form), env)).status, 204);
  assert.equal((await worker.fetch(post(payload()), env)).status, 204);
  assert.equal((await worker.fetch(post(payload('')), env)).status, 204);
  for (const mail of sent) {
    assert.equal(mail.from, 'Frondose Reports <forms@frondose.com>');
    assert.deepEqual(mail.to, ['support@frondose.com']);
    assert.equal(mail.text, 'Example report 🪴');
  }
  assert.equal(sent[0].reply_to, 'ada@example.com');
  assert.deepEqual(sent[0].attachments, [{ filename: 'example.png', content: 'AAH+' }]);
  assert.ok(sent.slice(1).every(mail => !Object.hasOwn(mail, 'reply_to')));
});

test('Worker fails closed with missing config, rate limits, invalid input or over-budget payloads', async () => {
  const worker = createReportWorker({ fetchImpl: () => assert.fail('Must not send') });
  assert.equal((await worker.fetch(new Request('https://forms.frondose.com/report'), env)).status, 405);
  assert.equal((await worker.fetch(post(payload()), { ...env, FEEDBACK_ENABLED: 'false' })).status, 503);
  assert.equal((await worker.fetch(post(payload()), { ...env, FEEDBACK_GLOBAL: null })).status, 503);
  assert.equal((await worker.fetch(post(payload(), { Origin: 'https://another.example' }), env)).status, 403);
  assert.equal((await worker.fetch(post(payload(), { 'Content-Length': String(FEEDBACK_WIRE_LIMIT + 1) }), env)).status, 413);
  const throttled = await worker.fetch(post(payload()), { ...env, FEEDBACK_GLOBAL: { async limit() { return { success: false }; } } });
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get('Retry-After'), '60');
  assert.equal((await worker.fetch(post(payload('bad address')), env)).status, 400);
  const huge = payload();
  huge.append('attachments', new Blob([new Uint8Array(19_999_999)]), 'large.png');
  assert.equal((await worker.fetch(post(huge), env)).status, 413);
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(FEEDBACK_WIRE_LIMIT + 1));
    controller.close();
  } });
  assert.equal((await worker.fetch(post(stream, { 'Content-Type': 'multipart/form-data; boundary=example' }), env)).status, 413);
});

test('wired desktop service and Worker round trip using mock Resend; never accept unrelated success responses', async () => {
  const sent = [];
  let acknowledged = true;
  const worker = createReportWorker({ fetchImpl: async (url, request) => {
    sent.push(JSON.parse(request.body));
    return acknowledged ? receipt() : Response.json({ message: 'no receipt' });
  } });
  const service = createDesktopReportService({ enabled: true, fetchImpl: async (url, req) => {
    assert.equal(url, 'https://forms.frondose.com/report');
    assert.equal(req.redirect, 'error');
    return worker.fetch(post(req.body), env);
  } });
  const input = { requestId: id, message: 'x'.repeat(10_001) + '\n漢', email: '', files: [{ name: 'one.png', bytes: new Uint8Array([7]) }] };
  assert.deepEqual(service.status(), { available: true });
  assert.deepEqual(await service.send(input), { ok: true });
  assert.equal(sent[0].text, input.message);
  assert.equal(sent[0].attachments[0].content, 'Bw==');
  assert.equal(Object.hasOwn(sent[0], 'reply_to'), false);
  acknowledged = false;
  assert.deepEqual(await service.send({ ...input, email: 'ada@example.com' }), { ok: false, error: 'delivery' });
  assert.equal(sent[1].reply_to, 'ada@example.com');
  const disabled = createDesktopReportService({ fetchImpl: () => assert.fail('Must not call network while disabled') });
  assert.deepEqual(disabled.status(), { available: false });
  assert.deepEqual(await disabled.send(input), { ok: false, error: 'unavailable' });
  assert.equal(JSON.parse(readFileSync(new URL('../desktop/report-config.json', import.meta.url))).enabled, false);
});
