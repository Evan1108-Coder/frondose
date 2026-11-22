import { FEEDBACK_WIRE_LIMIT, feedbackEmail, feedbackError, feedbackFilename, isFeedbackRequestId } from '../src/lib/feedback-report.js';

const reply = (status, error, headers = {}) => error
  ? Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
  : new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const resendEndpoint = 'https://api.resend.com/emails';

async function boundedForm(request) {
  const header = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(header) || !request.body) return { error: 415 };
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > FEEDBACK_WIRE_LIMIT)) return { error: 413 };
  let bytes = 0, tooLarge = false;
  const limited = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > FEEDBACK_WIRE_LIMIT) {
        tooLarge = true;
        controller.error(new RangeError('Feedback envelope is too large.'));
      } else {
        controller.enqueue(chunk);
      }
    },
  }));
  try {
    return { form: await new Response(limited, { headers: { 'Content-Type': header } }).formData() };
  } catch {
    return { error: tooLarge ? 413 : 400 };
  }
}

async function attachmentContent(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Encode in chunks in the Worker, without Node Buffer or argument-stack overflow.
  // Each interior chunk is divisible by three so base64 padding occurs only at the end.
  const parts = [];
  for (let start = 0; start < bytes.length; start += 24_576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 24_576))));
  }
  return { filename: feedbackFilename(file.name), content: parts.join('') };
}

export function createReportWorker({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env) {
      if (new URL(request.url).pathname !== '/report') return reply(404, 'not_found');
      if (request.method !== 'POST') return reply(405, 'method_not_allowed', { Allow: 'POST' });
      // Browser submissions are not enabled. This is an anonymous native endpoint,
      // not an authenticated relay: rate limits are required even without CORS.
      if (request.headers.has('origin')) return reply(403, 'browser_not_supported');
      const ip = request.headers.get('CF-Connecting-IP');
      if (env.FEEDBACK_ENABLED !== 'true' || !env.RESEND_API_KEY || !ip
          || typeof env.FEEDBACK_PER_IP?.limit !== 'function' || typeof env.FEEDBACK_GLOBAL?.limit !== 'function') {
        return reply(503, 'unavailable');
      }
      try {
        if (!(await env.FEEDBACK_PER_IP.limit({ key: ip })).success
            || !(await env.FEEDBACK_GLOBAL.limit({ key: 'feedback' })).success) {
          return reply(429, 'rate', { 'Retry-After': '60' });
        }
      } catch {
        return reply(503, 'unavailable');
      }
      const { form, error } = await boundedForm(request);
      if (!form) return reply(error, error === 413 ? 'size' : 'invalid');
      const messagePart = form.get('message');
      const message = messagePart && typeof messagePart !== 'string' ? await messagePart.text() : messagePart;
      const email = form.get('email') ?? '', id = form.get('requestId');
      const files = form.getAll('attachments');
      if (!isFeedbackRequestId(id) || files.some(file => typeof file === 'string')) return reply(400, 'invalid');
      const invalid = feedbackError(message, email, files.map(file => file.size));
      if (invalid) return reply(invalid === 'size' ? 413 : 400, invalid);
      const address = feedbackEmail(email);
      const attachments = [];
      for (const file of files) attachments.push(await attachmentContent(file));
      const payload = {
        from: 'Frondose Reports <forms@frondose.com>',
        to: ['support@frondose.com'],
        subject: 'New Frondose feedback',
        text: message,
        ...(address ? { reply_to: address } : {}),
        ...(attachments.length ? { attachments } : {}),
      };
      try {
        const sent = await fetchImpl(resendEndpoint, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `frondose-feedback/${id}`,
          },
          body: JSON.stringify(payload),
        });
        const result = sent.ok ? await sent.json() : null;
        if (typeof result?.id === 'string' && result.id) return reply(204);
        if (!sent.ok) await sent.body?.cancel();
        return sent.status === 429 ? reply(429, 'rate', { 'Retry-After': '60' }) : reply(502, 'delivery');
      } catch {
        return reply(502, 'delivery');
      }
    },
  };
}

export default createReportWorker();
