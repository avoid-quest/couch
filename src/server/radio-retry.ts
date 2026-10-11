import type { PlayerState, RadioRetry } from "../shared/protocol";

const delays = [1000, 2000, 4000];

// Short-lived connections share a budget. Only sustained, observed playback earns a new one.
export function createRadioRetry(now = Date.now) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let advancing: { since: number; position: number; start: number; speed: number } | null = null;
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; advancing = null; };
  return {
    cancel() { clear(); attempt = 0; },
    schedule(reconnect: () => void): RadioRetry {
      clear();
      const delay = delays[attempt];
      if (delay === undefined) return { attempt, maximum: delays.length, retryAt: null };
      attempt++;
      timer = setTimeout(() => { timer = null; reconnect(); }, delay);
      return { attempt, maximum: delays.length, retryAt: now() + delay };
    },
    observe(player: PlayerState) {
      if (player.status !== "playing" || !Number.isFinite(player.position)) { advancing = null; return; }
      const speed = player.speed ?? 1;
      if (!advancing || player.position <= advancing.position || speed !== advancing.speed) advancing = { since: now(), position: player.position, start: player.position, speed };
      else advancing.position = player.position;
      if (now() - advancing.since >= 30_000 && player.position - advancing.start >= 30 * speed) attempt = 0;
    },
  };
}
