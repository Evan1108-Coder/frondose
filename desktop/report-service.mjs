import { feedbackEmail, feedbackError, feedbackFilename, isFeedbackRequestId } from '../src/lib/feedback-report.js';

const endpoint = 'https://forms.frondose.com/report';

export function createDesktopReportService({ enabled = false, fetchImpl = fetch } = {}) {
  let inFlight = false;
  return {
    status: () => ({ available: enabled === true }),
    async send(payload) {
      if (enabled !== true) return { ok: false, error: 'unavailable' };
      if (inFlight) return { ok: false, error: 'busy' };
      if (!isFeedbackRequestId(payload?.requestId) || !Array.isArray(payload?.files)
          || payload.files.some(file => !(file?.bytes instanceof Uint8Array) || typeof file.name !== 'string')) {
        return { ok: false, error: 'invalid' };
      }
      const error = feedbackError(payload.message, payload.email, payload.files.map(file => file.bytes.byteLength));
      if (error) return { ok: false, error };
      const report = new FormData();
      // A string multipart field normalizes LF to CRLF during serialization.
      // Send text as a UTF-8 part so both sides count the same draft bytes.
      report.set('message', new Blob([payload.message], { type: 'text/plain; charset=utf-8' }), 'feedback.txt');
      report.set('email', feedbackEmail(payload.email));
      report.set('requestId', payload.requestId);
      for (const file of payload.files) report.append('attachments', new Blob([file.bytes]), feedbackFilename(file.name));
      inFlight = true;
      try {
        const response = await fetchImpl(endpoint, { method: 'POST', body: report, redirect: 'error', signal: AbortSignal.timeout(40_000) });
        const error = { 400: 'invalid', 413: 'size', 429: 'rate', 503: 'unavailable' }[response.status] ?? 'delivery';
        // Accept only the explicit receipt issued by the configured Worker.
        if (response.status === 204) return { ok: true };
        await response.body?.cancel();
        return { ok: false, error };
      } catch {
        return { ok: false, error: 'delivery' };
      } finally {
        inFlight = false;
      }
    },
  };
}
