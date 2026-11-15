import { useCallback, useRef, useSyncExternalStore } from "react";

// A button on the page that opens the same floating chat as the round button (the Dashboard's
// "Chat with Godspeed"). While one is on screen, a narrow window shows no round button: there it
// sat over the bottom-right corner of the Dashboard's Godspeed card, so what was there could not be
// read or pressed (issue #530). Scrolled past it, the round button is back.
const inView = new Map<Element, boolean>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => [...inView.values()].some(Boolean);

/** Whether a button marked with useChatEntry is on screen now. */
export const useChatEntryInView = () => useSyncExternalStore(subscribe, snapshot, () => false);

/** A ref for a button that opens the floating chat. Without IntersectionObserver it counts as off screen. */
export function useChatEntry<T extends Element>() {
  const stop = useRef<() => void>();
  return useCallback((el: T | null) => {
    stop.current?.();
    stop.current = undefined;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) inView.set(e.target, e.isIntersecting);
      notify();
    });
    observer.observe(el);
    stop.current = () => { observer.disconnect(); inView.delete(el); notify(); };
  }, []);
}
