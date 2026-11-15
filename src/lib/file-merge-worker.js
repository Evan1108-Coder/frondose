export function mergeFileInWorker(base, mine, disk, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('../workers/file-merge.worker.js', import.meta.url), { type: 'module' });
    const finish = (error, plan) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.terminate(); error ? reject(error) : resolve(plan); };
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(Error('Comparison took too long. Your draft is unchanged; use an external editor to merge it.')), 2500);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = event => finish(event.data.error ? Error(event.data.error) : null, event.data.plan);
    worker.onerror = () => finish(Error('Comparison could not run. Your draft is unchanged.'));
    worker.postMessage([base, mine, disk]);
  });
}
