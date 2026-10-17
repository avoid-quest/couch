/** How long a press is held to open an item's menu: OK on a remote, as on Apple TV and Android TV, or a long press on touch. */
export const holdDelay = 500;

/** A press that acts when released or, held for holdDelay, runs onHold once; release() ends it and says whether it was short. */
export function startHold(onHold: () => void, delay = holdDelay) {
  let held = false;
  const timer = setTimeout(() => { held = true; onHold(); }, delay);
  return { release: () => { clearTimeout(timer); return !held; } };
}
