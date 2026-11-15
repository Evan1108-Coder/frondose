import { planFileMerge } from '../lib/file-merge.js';
self.onmessage = event => {
  try { self.postMessage({ plan: planFileMerge(...event.data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
