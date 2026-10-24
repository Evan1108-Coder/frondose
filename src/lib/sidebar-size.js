export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_HIDE_THRESHOLD = 72;
export const SIDEBAR_DEFAULT_WIDTH = 240;
export const SIDEBAR_PREVIEW_MIN_VIEWPORT = 1000;

export function canShowSidebarPreview(viewportWidth, viewportHeight = 700) {
  return viewportWidth >= SIDEBAR_PREVIEW_MIN_VIEWPORT && viewportHeight >= 600;
}

export function shouldEnterSidebarPreview(clientX, viewportWidth, viewportHeight = 700) {
  return canShowSidebarPreview(viewportWidth, viewportHeight) && clientX >= viewportWidth * 0.8;
}

export function clampPagePreview(value, viewportWidth, viewportHeight) {
  const maxWidth = Math.min(600, Math.round(viewportWidth * 0.55));
  const requestedWidth = Number(value?.width);
  const width = Math.max(280, Math.min(Number.isFinite(requestedWidth) && value?.width != null ? requestedWidth : 390, maxWidth));
  const height = Math.round(width * (viewportHeight - 24) / (viewportWidth - 24));
  const requestedX = Number(value?.x), requestedY = Number(value?.y);
  const x = Math.max(12, Math.min(Number.isFinite(requestedX) && value?.x != null ? requestedX : viewportWidth - width - 38, viewportWidth - width - 12));
  const y = Math.max(12, Math.min(Number.isFinite(requestedY) && value?.y != null ? requestedY : viewportHeight - height - 38, viewportHeight - height - 12));
  return { width, height, x, y, scale: width / (viewportWidth - 24) };
}

export function sidebarMaxWidth(viewportWidth) {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(Math.round(viewportWidth * 0.62), viewportWidth - 300));
}

export function clampSidebarWidth(width, viewportWidth) {
  const value = Number(width);
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(Math.round(value), sidebarMaxWidth(viewportWidth)));
}

export function normalizeSidebarSize(value, viewportWidth = 1280) {
  return {
    width: value?.width == null ? null : clampSidebarWidth(value.width, viewportWidth),
    hidden: value?.hidden === true,
  };
}

export function sidebarWidthFromPointer(clientX, viewportWidth, inset = 12) {
  return clientX - inset <= SIDEBAR_HIDE_THRESHOLD ? 0 : clampSidebarWidth(clientX - inset, viewportWidth);
}
