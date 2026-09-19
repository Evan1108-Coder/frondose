export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export function imageFileError(file) {
  if (!file || !IMAGE_TYPES.includes(file.type)) return 'Choose a PNG, JPEG, or WebP image.';
  if (!file.size || file.size > MAX_IMAGE_BYTES) return 'Choose an image smaller than 10 MB.';
  return null;
}
export function cropGeometry(width, height, zoom = 1, x = 0, y = 0) {
  if (!(width > 0 && height > 0)) throw new Error('Invalid image dimensions.');
  const side = Math.min(width, height) / Math.max(1, Math.min(3, zoom));
  const clamp = value => Math.max(-1, Math.min(1, Number(value) || 0));
  return { side, sx: (width - side) * (clamp(x) + 1) / 2, sy: (height - side) * (clamp(y) + 1) / 2 };
}
