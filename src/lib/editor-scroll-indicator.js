/** Geometry only: never writes to CodeMirror's scroll position. */
export function editorScrollPosition({ top = 0, height = 0, scrollHeight = 0, trackHeight = height } = {}) {
  const finite = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  height = finite(height); scrollHeight = finite(scrollHeight); trackHeight = finite(trackHeight);
  const range = Math.max(0, scrollHeight - height);
  const visible = height > 0 && trackHeight > 0 && range > 1;
  const progress = visible ? Math.max(0, Math.min(1, Number.isFinite(top) ? top / range : 0)) : 0;
  const size = visible ? Math.min(trackHeight, Math.max(24, trackHeight * height / scrollHeight)) : trackHeight;
  return { visible, size, offset: Math.max(0, trackHeight - size) * progress, percent: Math.round(progress * 100) };
}

/** A passive sibling outside scroll-fade masks, not a second scroll owner.
 * All reads precede writes; one frame is shared by scroll/resize/content events. */
export function installEditorScrollIndicator(scroller, indicator) {
  const win = scroller.ownerDocument.defaultView;
  const thumb = indicator.querySelector('[data-scroll-thumb]'), label = indicator.querySelector('[data-scroll-percent]');
  let frame = 0, previous = '';
  const update = () => {
    frame = 0;
    if (!scroller.isConnected || !indicator.isConnected) return;
    const value = editorScrollPosition({ top: scroller.scrollTop, height: scroller.clientHeight, scrollHeight: scroller.scrollHeight });
    const parent = indicator.parentElement, bounds = parent.getBoundingClientRect();
    const scale = parent.offsetHeight > 0 && bounds.height > 0 ? bounds.height / parent.offsetHeight : 1;
    const origin = Math.max(0, (scroller.getBoundingClientRect().top - bounds.top) / scale);
    const key = `${origin}:${scroller.clientHeight}:${value.visible}:${value.size}:${value.offset}:${value.percent}`;
    if (key === previous) return;
    previous = key;
    indicator.style.top = `${origin}px`;
    indicator.style.height = `${scroller.clientHeight}px`;
    indicator.hidden = !value.visible;
    indicator.setAttribute('aria-valuenow', String(value.percent));
    indicator.setAttribute('aria-valuetext', `${value.percent}% scrolled`);
    thumb.style.height = `${value.size}px`;
    thumb.style.transform = `translateY(${value.offset}px)`;
    label.style.transform = `translateY(${value.offset}px)`;
    label.textContent = `${value.percent}%`;
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
  const resize = new win.ResizeObserver(schedule);
  resize.observe(scroller);
  for (const child of scroller.children) resize.observe(child);
  scroller.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('resize', schedule, { passive: true });
  schedule();
  return () => { win.cancelAnimationFrame(frame); resize.disconnect(); scroller.removeEventListener('scroll', schedule); win.removeEventListener('resize', schedule); };
}
