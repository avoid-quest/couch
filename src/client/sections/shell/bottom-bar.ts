import { useLayoutEffect, type RefObject } from "react";

// Bars at the bottom of the viewport (the shell's footer, the player band) can overlap
// for a commit during navigation, so the tallest registered one wins.
const bars = new Map<HTMLElement, number>();
function publishBars() {
  const height = Math.max(0, ...bars.values());
  if (height) document.documentElement.style.setProperty("--bottom-bar", `${height}px`);
  else document.documentElement.style.removeProperty("--bottom-bar");
}

/** Publishes --bottom-bar before paint; contentKey also measures when the shell adds/removes its playing bar. */
export function useBottomBar(
  ref: RefObject<HTMLElement | null>,
  shown = true,
  contentKey?: boolean,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shown) return;
    const measure = () => {
      bars.set(element, element.offsetHeight);
      publishBars();
    };
    const observer = new ResizeObserver(([entry]) => {
      bars.set(element, Math.round(entry!.borderBoxSize[0]!.blockSize));
      publishBars();
    });
    // The border box: the player band drops its scrim's padding when Up next opens.
    observer.observe(element, { box: "border-box" });
    measure();
    return () => {
      observer.disconnect();
      bars.delete(element);
      publishBars();
    };
  }, [ref, shown, contentKey]);
}
