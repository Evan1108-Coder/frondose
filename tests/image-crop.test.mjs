import test from 'node:test';
import assert from 'node:assert/strict';
import { imageFileError, cropGeometry } from '../src/lib/image-crop.js';
import { validateAvatar } from '../server/validation.mjs';

test('crop accepts only bounded supported raster files', () => {
  assert.equal(imageFileError({ type: 'image/png', size: 1000 }), null);
  assert.ok(imageFileError({ type: 'image/svg+xml', size: 1000 }));
  assert.ok(imageFileError({ type: 'image/png', size: 11 * 1024 * 1024 }));
  assert.ok(imageFileError({ type: 'image/png', size: 0 }));
});
test('crop geometry covers portrait/landscape and clamps movement', () => {
  assert.deepEqual(cropGeometry(1000, 500), { side: 500, sx: 250, sy: 0 });
  assert.deepEqual(cropGeometry(500, 1000, 2, 1, -1), { side: 250, sx: 250, sy: 0 });
  assert.deepEqual(cropGeometry(1000, 500, 1, 100, -100), { side: 500, sx: 500, sy: 0 });
  assert.throws(() => cropGeometry(0, 1));
});
test('image persistence rejects spoofed raster payloads and executable URLs', () => {
  assert.throws(() => validateAvatar('data:image/png;base64,PGh0bWw+'));
  assert.throws(() => validateAvatar('javascript:alert(1)'));
  assert.throws(() => validateAvatar('data:image/svg+xml;base64,PHN2Zz4='));
  assert.doesNotThrow(() => validateAvatar(null));
});
