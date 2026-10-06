import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalArrivals } from '../src/lib/terminal-arrival.js';

test('only complete new plain-text lines are mirrored', () => {
  assert.deepEqual(terminalArrivals('', 'hel'), { pending: 'hel', lines: [] });
  assert.deepEqual(terminalArrivals('hel', 'lo\nnext\npar'), { pending: 'par', lines: ['hello', 'next'] });
});

test('initial history is not presented as a fresh arrival', () => {
  assert.deepEqual(terminalArrivals('', 'old\npartial', { initial: true }), { pending: null, lines: [] });
  assert.deepEqual(terminalArrivals(null, ' suffix\nfresh\n'), { pending: '', lines: ['fresh'] });
});

test('terminal control sequences and redraws are left to xterm only', () => {
  assert.deepEqual(terminalArrivals('', '\x1b[2Kupdated\n'), { pending: '', lines: [] });
  assert.deepEqual(terminalArrivals('', 'progress\rupdated\n'), { pending: '', lines: [] });
});
