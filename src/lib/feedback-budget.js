export const FEEDBACK_LIMIT = 20_000_000;
const encoder = new TextEncoder();
export const feedbackTextBytes = text => encoder.encode(text).byteLength;
export const feedbackFits = bytes => bytes < FEEDBACK_LIMIT;
export const feedbackFileKey = file => JSON.stringify([file.name, file.size, file.lastModified]);

export function addFeedbackFiles(draft, incoming) {
  const files = [...draft.files];
  const seen = new Set(files.map(feedbackFileKey));
  let { fileBytes } = draft;
  let overLimit = false;
  for (const file of incoming) {
    const key = feedbackFileKey(file);
    if (seen.has(key)) continue;
    if (!feedbackFits(draft.textBytes + fileBytes + file.size)) {
      overLimit = true;
      continue;
    }
    files.push(file);
    seen.add(key);
    fileBytes += file.size;
  }
  return { files, fileBytes, overLimit };
}
