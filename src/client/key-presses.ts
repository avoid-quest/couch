/** Says whether to take a key's press; it hears each press once, on its first keydown. */
type Claim = (event: Pick<KeyboardEvent, "key" | "timeStamp">) => boolean;

/** Key presses taken whole: their keydown, every repeat and the keyup reach nothing else. */
export function keyPresses() {
  const claims = new Set<Claim>();
  const taken = new Set<string>();
  const claim = (handler: Claim) => {
    claims.add(handler);
    return () => void claims.delete(handler);
  };
  const takes = (event: Pick<KeyboardEvent, "type" | "key" | "repeat" | "timeStamp">) => {
    if (event.type === "keyup") return taken.delete(event.key);
    if (event.repeat) return taken.has(event.key);
    // A new press of the key: one taken earlier lost its keyup, as when the window lost focus.
    taken.delete(event.key);
    let claimed = false;
    // Every claim hears the press: the resting TV counts it as activity even when the controller takes it.
    for (const handler of claims) claimed = handler(event) || claimed;
    if (claimed) taken.add(event.key);
    return claimed;
  };
  return { claim, takes };
}

const presses = keyPresses();

/** Takes the whole press of a key the handler claims: the press that wakes the resting TV, a controller's echo. */
export const claimKeyPresses = presses.claim;

/**
 * Listens ahead of every listener the app adds later, so a taken press reaches none of them whatever order they were
 * added in. Couch's own synthetic keys (navigation.ts) follow a press already let through, so only real ones count.
 */
export function listenForKeyPresses() {
  const listener = (event: KeyboardEvent) => {
    if (!event.isTrusted || !presses.takes(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", listener, true);
  window.addEventListener("keyup", listener, true);
}
