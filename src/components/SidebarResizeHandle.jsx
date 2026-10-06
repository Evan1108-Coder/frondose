import { canShowSidebarPreview, sidebarMaxWidth, SIDEBAR_MIN_WIDTH } from '../lib/sidebar-size.js';
import { useEffect } from 'react';

export function SidebarResizeHandle({ width, preview = false, onResize, onHide, onRestore }) {
  useEffect(() => () => document.documentElement.classList.remove('sidebar-resizing'), []);
  const pointerDown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const initialWidth = width;
    handle.setPointerCapture(event.pointerId);
    document.documentElement.classList.add('sidebar-resizing');
    const move = next => onResize(next.clientX, initialWidth);
    const finish = next => {
      if (next.clientX - 12 <= 72) onHide(preview ? undefined : initialWidth);
      else onResize(next.clientX, initialWidth);
      document.documentElement.classList.remove('sidebar-resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', cancel);
    };
    const cancel = () => {
      document.documentElement.classList.remove('sidebar-resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', cancel);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', cancel);
  };
  const keyDown = event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (preview && event.key === 'ArrowLeft') onRestore();
      else if (!preview) onResize(12 + width + (event.key === 'ArrowRight' ? 24 : -24));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onHide(preview ? undefined : width);
    } else if (event.key === 'End') {
      event.preventDefault();
      onResize(window.innerWidth - 12, width);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onRestore();
    }
  };
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
  const fullPreviewAvailable = canShowSidebarPreview(viewportWidth, viewportHeight);
  return <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-label="Resize navigation sidebar" aria-orientation="vertical" aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={fullPreviewAvailable ? viewportWidth - 24 : sidebarMaxWidth(viewportWidth)} aria-valuenow={Math.round(width)} aria-valuetext={preview ? 'Full-width navigation. Press Left to return to the normal layout, or Enter to restore.' : `${Math.round(width)} pixels. Press End to ${fullPreviewAvailable ? 'open full-width navigation' : 'use the maximum width'} or Home to hide.`} onPointerDown={pointerDown} onKeyDown={keyDown} />;
}
