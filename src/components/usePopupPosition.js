import { useLayoutEffect, useState } from "react";

// Panels stay inside their owning dialog for focus containment, while fixed
// placement lets them escape a scrolling form without getting clipped.
export function usePopupPosition(open, anchor, { width, height = 320 } = {}) {
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    let frame;
    function measure() {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const viewWidth = viewport?.width ?? window.innerWidth;
      const viewHeight = viewport?.height ?? window.innerHeight;
      const panelWidth = Math.min(width ?? rect.width, viewWidth - 24);
      const below = topEdge + viewHeight - rect.bottom - 14;
      const above = rect.top - topEdge - 14;
      const upwards = below < height && above > below;
      const maxHeight = Math.max(80, Math.min(height, upwards ? above : below));
      let originX = 0;
      let originY = 0;
      // Transforms (mobile sidebar / dialog entry) and backdrop filters create
      // containing blocks even for position:fixed descendants.
      for (let parent = anchor.current.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.transform !== "none" || style.perspective !== "none" || style.filter !== "none" || (style.backdropFilter && style.backdropFilter !== "none") || /paint|layout|strict|content/.test(style.contain) || /transform|perspective|filter/.test(style.willChange)) {
          const bounds = parent.getBoundingClientRect();
          originX = bounds.left + parent.clientLeft - parent.scrollLeft;
          originY = bounds.top + parent.clientTop - parent.scrollTop;
          break;
        }
      }
      setPosition({
        position: "fixed",
        width: panelWidth,
        left: Math.max(leftEdge + 12, Math.min(rect.left, leftEdge + viewWidth - panelWidth - 12)) - originX,
        top: (upwards ? Math.max(topEdge + 12, rect.top - maxHeight - 6) : rect.bottom + 6) - originY,
        maxHeight,
        transformOrigin: upwards ? "bottom left" : "top left",
      });
    }
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("animationend", schedule, true);
    window.addEventListener("transitionend", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("animationend", schedule, true);
      window.removeEventListener("transitionend", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [open, anchor, width, height]);
  return position;
}
