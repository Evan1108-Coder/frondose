import assert from 'node:assert/strict';
import test from 'node:test';
import { addFeedbackFiles, feedbackFits, feedbackTextBytes, FEEDBACK_LIMIT } from '../src/lib/feedback-budget.js';

const file = (name, size) => ({ name, size, lastModified: 0 });
const empty = { files: [], fileBytes: 0, textBytes: 0 };

test('feedback text is counted as UTF-8 bytes with a strict shared 20 MB budget', () => {
  assert.equal(feedbackTextBytes('Aé漢🪴'), 10);
  assert.equal(feedbackTextBytes('x'.repeat(10_001)), 10_001);
  assert.equal(feedbackFits(FEEDBACK_LIMIT - 1), true);
  assert.equal(feedbackFits(FEEDBACK_LIMIT), false);
});

test('attachments have no separate count or size cap and duplicates do not use space', () => {
  const large = file('large.bin', 12_000_000);
  const files = [large, ...Array.from({ length: 8 }, (_, i) => file(`${i}.txt`, 100)), large];
  assert.deepEqual(addFeedbackFiles(empty, files), { files: files.slice(0, -1), fileBytes: 12_000_800, overLimit: false });
});

test('attachment admission includes existing files and multibyte draft text', () => {
  const kept = file('kept.bin', FEEDBACK_LIMIT - 5);
  const draft = { files: [kept], fileBytes: kept.size, textBytes: feedbackTextBytes('漢') };
  const small = file('small.txt', 1);
  assert.deepEqual(addFeedbackFiles(draft, [file('at-limit.txt', 2), small]), {
    files: [kept, small], fileBytes: kept.size + 1, overLimit: true,
  });
  assert.deepEqual(draft.files, [kept]);
});
