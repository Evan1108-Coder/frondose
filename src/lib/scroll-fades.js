// Visual-only scroll state: one passive listener, no React renders per scroll.
export function scrollFadeEdges({ top = 0, left = 0, height, width, scrollHeight, scrollWidth, vertical = true, horizontal = true, rtl = false }) {
  const y = Math.max(0, scrollHeight - height), x = Math.max(0, scrollWidth - width);
  const clamp = (value, max) => Math.min(max, Math.max(0, value));
  const positionY = clamp(top, y), positionX = clamp(rtl ? x + left : left, x);
  const edge = (distance, size) => distance <= 1 ? 0 : Math.min(24, size / 4, distance);
  return [vertical ? edge(positionY, height) : 0, horizontal ? edge(x - positionX, width) : 0, vertical ? edge(y - positionY, height) : 0, horizontal ? edge(positionX, width) : 0];
}

export function installScrollFades(doc = document) {
  const win = doc.defaultView;
  const candidates = new Set(), observed = new Set(), styles = new WeakMap();
  let frame = 0, rescan = true;
  const schedule = (scan = false) => {
    rescan ||= scan;
    if (!frame) frame = win.requestAnimationFrame(update);
  };
  const resize = new win.ResizeObserver(() => schedule());
  function update() {
    frame = 0;
    if (rescan) {
      rescan = false;
      const next = new Set();
      for (const element of doc.querySelectorAll('body *')) {
        if (!(element instanceof win.HTMLElement)) continue;
        const css = win.getComputedStyle(element);
        if (/(auto|scroll)/.test(`${css.overflowX} ${css.overflowY}`)) next.add(element);
      }
      for (const element of candidates) if (!next.has(element)) {
        element.removeAttribute('data-scroll-fade');
        for (const side of ['top', 'right', 'bottom', 'left']) element.style.removeProperty(`--scroll-fade-${side}`);
        styles.set(element, element.getAttribute('style'));
      }
      candidates.clear();
      const nextObserved = new Set();
      for (const element of next) {
        candidates.add(element); nextObserved.add(element);
        for (const child of element.children) nextObserved.add(child);
      }
      for (const element of observed) if (!nextObserved.has(element)) { resize.unobserve(element); observed.delete(element); }
      for (const element of nextObserved) if (!observed.has(element)) { resize.observe(element); observed.add(element); }
    }
    // Read all geometry before writing any masks.
    const measurements = [...candidates].filter(element => element.isConnected).map(element => {
      const css = win.getComputedStyle(element);
      return [element, scrollFadeEdges({ top: element.scrollTop, left: element.scrollLeft, height: element.clientHeight, width: element.clientWidth, scrollHeight: element.scrollHeight, scrollWidth: element.scrollWidth, vertical: /auto|scroll/.test(css.overflowY), horizontal: /auto|scroll/.test(css.overflowX), rtl: css.direction === 'rtl' })];
    });
    for (const [element, edges] of measurements) {
      if (edges.some(Boolean)) {
        if (!element.hasAttribute('data-scroll-fade')) element.setAttribute('data-scroll-fade', '');
        ['top', 'right', 'bottom', 'left'].forEach((side, index) => {
          const value = `${edges[index]}px`, key = `--scroll-fade-${side}`;
          if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value);
        });
        styles.set(element, element.getAttribute('style'));
      } else element.removeAttribute('data-scroll-fade');
    }
  }
  const mutations = new win.MutationObserver(records => {
    if (records.some(record => record.type !== 'attributes' || record.attributeName !== 'style' || styles.get(record.target) !== record.target.getAttribute('style'))) schedule(true);
  });
  mutations.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'dir'] });
  const scroll = () => schedule();
  const layout = () => schedule(true);
  doc.addEventListener('scroll', scroll, { capture: true, passive: true });
  doc.addEventListener('load', layout, true);
  win.addEventListener('resize', layout, { passive: true });
  schedule(true);
  return () => {
    win.cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect();
    doc.removeEventListener('scroll', scroll, true); doc.removeEventListener('load', layout, true); win.removeEventListener('resize', layout);
    for (const element of candidates) {
      element.removeAttribute('data-scroll-fade');
      for (const side of ['top', 'right', 'bottom', 'left']) element.style.removeProperty(`--scroll-fade-${side}`);
    }
  };
}
