import { validContextInspection } from './context-inspector-ui.js';

// Call only in an explicit submit handler. Recovering uncertain delivery must keep
// its original turn identity, rather than authorizing a different captured input.
export async function prepareExplicitChatSend({ request, reviewed, recovering = false, inspect, isCurrent = () => true }) {
  if (recovering) return null;
  if (!request) throw new Error('No message context is available.');
  const captured = reviewed || await inspect(request);
  if (!validContextInspection(captured) || Date.parse(captured.expires_at) <= Date.now()) {
    throw Object.assign(new Error('Message context could not be prepared. Send again to retry.'), { status: 409 });
  }
  if (!isCurrent()) throw Object.assign(new Error('The draft changed while preparing context. Review the message and send again.'), { status: 409 });
  return captured;
}
