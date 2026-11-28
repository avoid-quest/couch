// "Tap to hear" (#644): whether this browser waits for a gesture before it plays sound, and the gesture that lets it.
// The renderer reports it; the player offers Tap to hear where Play is. Kept apart from the renderer, which needs a page.
let waiting = false;
let answer = () => {};
const listeners = new Set<() => void>();

export const waitingForTap = () => waiting;
export function subscribeTapToHear(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** The renderer's report: whether it waits, and what a tap does. */
export function reportTapToHear(value: boolean, hear: () => void) {
  answer = hear;
  if (waiting === value) return;
  waiting = value;
  listeners.forEach((listener) => listener());
}
export const tapToHear = () => answer();
