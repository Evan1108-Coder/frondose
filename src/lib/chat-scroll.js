export const nearChatBottom = element => element.scrollHeight - element.clientHeight - element.scrollTop < 100;

/** One cancellable animation, never a wheel hijack. Dependencies are injected for tests. */
export function createChatFollower(element, { frame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, smooth = () => true, onChange = () => {} } = {}) {
  let following = true, animation = null, disposed = false;
  const stop = () => { if (animation !== null) cancelFrame(animation); animation = null; };
  const setFollowing = value => { following = value; onChange(value); };
  function toBottom(immediate = false) {
    if (disposed) return;
    setFollowing(true);
    if (immediate || !smooth()) { stop(); element.scrollTop = element.scrollHeight; return; }
    if (animation !== null) return;
    const from = element.scrollTop;
    let started;
    function step(time) {
      if (disposed) return;
      started ??= time;
      const fraction = Math.min(1, (time - started) / 320);
      const target = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = from + (target - from) * (1 - (1 - fraction) ** 3);
      if (fraction < 1 && smooth()) animation = frame(step);
      else { element.scrollTop = target; animation = null; }
    }
    animation = frame(step);
  }
  return {
    toBottom,
    contentChanged() { if (following) toBottom(); },
    onScroll() { if (animation === null) setFollowing(nearChatBottom(element)); },
    pause() { stop(); setFollowing(false); },
    resume() { setFollowing(true); toBottom(); },
    dispose() { disposed = true; stop(); },
  };
}
