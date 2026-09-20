import { useEffect, useRef, useState } from 'react';
import { createChatFollower } from './chat-scroll.js';
import { useDisplayPreferences } from './display-preferences.js';

export function useChatFollow(listRef, contentKey, reduceMotion) {
  const [settings] = useDisplayPreferences();
  const [atBottom, setAtBottom] = useState(true);
  const controller = useRef(null), preferences = useRef(null);
  preferences.current = { smooth: settings.smoothChatScroll, reduceMotion };
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const follower = createChatFollower(element, { onChange: setAtBottom, smooth: () => preferences.current.smooth && !preferences.current.reduceMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches });
    controller.current = follower;
    const scroll = () => follower.onScroll();
    const wheel = event => { if (event.deltaY < 0) follower.pause(); };
    const interrupt = () => follower.pause();
    const key = event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) follower.pause(); };
    element.addEventListener('scroll', scroll, { passive: true });
    element.addEventListener('wheel', wheel, { passive: true });
    element.addEventListener('touchstart', interrupt, { passive: true });
    element.addEventListener('pointerdown', interrupt);
    element.addEventListener('keydown', key);
    const resize = new ResizeObserver(() => follower.contentChanged());
    function observe() { resize.disconnect(); resize.observe(element); for (const child of element.children) resize.observe(child); follower.contentChanged(); }
    const mutations = new MutationObserver(observe);
    mutations.observe(element, { childList: true });
    observe(); follower.toBottom(true);
    return () => {
      follower.dispose(); controller.current = null; resize.disconnect(); mutations.disconnect();
      element.removeEventListener('scroll', scroll); element.removeEventListener('wheel', wheel); element.removeEventListener('touchstart', interrupt); element.removeEventListener('pointerdown', interrupt); element.removeEventListener('keydown', key);
    };
  }, [listRef]);
  useEffect(() => { controller.current?.contentChanged(); }, [contentKey]);
  return { atBottom, scrollToEnd: () => controller.current?.toBottom(), setFollowing: value => value ? controller.current?.resume() : controller.current?.pause() };
}
