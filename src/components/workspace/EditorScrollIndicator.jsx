import { useEffect, useRef } from 'react';
import { installEditorScrollIndicator } from '../../lib/editor-scroll-indicator.js';

export function EditorScrollIndicator({ scroller }) {
  const indicator = useRef(null);
  useEffect(() => scroller ? installEditorScrollIndicator(scroller, indicator.current) : undefined, [scroller]);
  return <div ref={indicator} className="directory-scroll-indicator" data-editor-scroll-indicator="" role="progressbar" aria-label="File scroll position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} aria-valuetext="0% scrolled" hidden><span className="directory-scroll-thumb" data-scroll-thumb=""/><span className="directory-scroll-percent" data-scroll-percent="" aria-hidden="true">0%</span></div>;
}
