import { feedbackFits, feedbackTextBytes } from './feedback-budget.js';

export const FEEDBACK_WIRE_LIMIT = 28_000_000;
export const isFeedbackRequestId = id => typeof id === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);

export function feedbackEmail(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const email = value.trim();
  if (!email) return '';
  if (email.length > 254) return null;
  const [name, domain, extra] = email.split('@');
  if (extra !== undefined || !domain || name.length > 64 || !/^[a-z\d!#$%&'*+/=?^_`{|}~.-]+$/i.test(name)
      || name.startsWith('.') || name.endsWith('.') || name.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return null;
  return email;
}

export function feedbackError(message, email, attachments) {
  if (typeof message !== 'string' || !message.trim()) return 'message';
  if (feedbackEmail(email) === null) return 'email';
  let bytes = feedbackTextBytes(message);
  for (const size of attachments) bytes += size;
  return feedbackFits(bytes) ? null : 'size';
}

export function feedbackFilename(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f/\\:"]/g, '_').trim().slice(0, 180) || 'attachment'
    : 'attachment';
}
