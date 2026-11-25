import { useEffect, useMemo, useRef, type PointerEvent } from "react";

// Android's double-tap timeout, from one tap's release to the next press. Video.js's doubletap allows
// 200 ms between releases, which misses a relaxed double-tap.
const DOUBLE_TAP_MS = 300;
// Video.js's tap threshold: a longer press is a hold.
const TAP_MS = 250;
// As on row menus, a resting finger may move slightly.
const TAP_SLOP = 10;

export type TapSide = "left" | "right";

/**
 * Tells a finger's taps from double-taps on the picture. With `doubleTap`, a single tap waits out the double-tap
 * window; without it, a tap acts at once.
 */
export function useTouchTaps(tap: () => void, doubleTap?: (side: TapSide) => void) {
  const latest = useRef({ tap, doubleTap });
  latest.current = { tap, doubleTap };
  const taps = useRef<{
    down?: { x: number; y: number; at: number };
    // The press came while a tap waited: its release is the double-tap.
    second?: boolean;
    pending?: ReturnType<typeof setTimeout>;
  }>({});
  useEffect(() => () => clearTimeout(taps.current.pending), []);
  return useMemo(() => {
    const state = taps.current;
    const reset = () => {
      state.down = undefined;
      state.second = false;
    };
    return {
      down(event: PointerEvent) {
        if (!event.isPrimary) return reset();
        state.down = { x: event.clientX, y: event.clientY, at: Date.now() };
        state.second = state.pending !== undefined;
        clearTimeout(state.pending);
        state.pending = undefined;
      },
      move(event: PointerEvent) {
        const down = state.down;
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP) reset();
      },
      cancel: reset,
      up(event: PointerEvent<HTMLElement>) {
        const { down, second } = state;
        reset();
        if (!down || Date.now() - down.at > TAP_MS) return;
        const { tap, doubleTap } = latest.current;
        if (!doubleTap) return tap();
        if (second) {
          const { left, width } = event.currentTarget.getBoundingClientRect();
          return doubleTap(event.clientX < left + width / 2 ? "left" : "right");
        }
        state.pending = setTimeout(() => {
          state.pending = undefined;
          latest.current.tap();
        }, DOUBLE_TAP_MS);
      },
    };
  }, []);
}
