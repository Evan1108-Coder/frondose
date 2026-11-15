/** Small ordered batches; failed writes are uncertain and never replayed. */
export function createTerminalInputQueue({ send, onError = () => {}, onWritten = () => {}, delay = 4, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let buffer = '', timer = null, busy = false, disposed = false, queuedLength = 0;
  const chunks = [];
  async function flush() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    while (buffer) {
      let size = Math.min(16000, buffer.length);
      if (size < buffer.length && /[\uD800-\uDBFF]/.test(buffer[size - 1])) size--;
      chunks.push(buffer.slice(0, size)); queuedLength += size; buffer = buffer.slice(size);
    }
    if (disposed || busy || !chunks.length) return;
    busy = true;
    try { while (!disposed && chunks.length) { const chunk = chunks.shift(); queuedLength -= chunk.length; await send(chunk); if (!disposed) onWritten(); } }
    catch (error) { buffer = ''; chunks.length = 0; queuedLength = 0; if (!disposed) onError(error); }
    finally { busy = false; }
  }
  return {
    enqueue(value) {
      if (disposed || typeof value !== 'string' || !value) return;
      if (queuedLength + buffer.length + value.length > 64000) { onError(new Error('Terminal input queue is full. Wait for the current input to finish.')); return; }
      buffer += value;
      // Do not reset per keystroke: sustained typing must keep flowing.
      if (timer === null) timer = setTimer(flush, delay);
    },
    flush,
    dispose() { disposed = true; if (timer !== null) clearTimer(timer); timer = null; buffer = ''; chunks.length = 0; queuedLength = 0; },
  };
}
