const idleWindow = 10 * 60_000;

export function createUpdateIdle(now = () => performance.now()) {
  let since = now();
  let playback = "unavailable", reconnecting = false, otherBusy = false;
  const work = new Map<symbol, string>();
  const activity = () => { since = now(); };
  return {
    activity,
    workReason: () => work.values().next().value ?? null,
    playback(status: string, radioRetry: boolean) {
      if (playback !== status || reconnecting !== radioRetry || !["idle", "ended", "error"].includes(status) || radioRetry) activity();
      playback = status; reconnecting = radioRetry;
    },
    begin(reason: string) {
      const id = Symbol(); work.set(id, reason); activity();
      return () => { if (work.delete(id)) activity(); };
    },
    reason(otherWork: string | null = null) {
      if (otherBusy && !otherWork) activity();
      otherBusy = !!otherWork;
      let active = work.values().next().value ?? otherWork;
      if (reconnecting) active = "Waiting for radio reconnect to stop.";
      else if (playback === "unavailable") active = "Waiting for the Couch app to connect.";
      else if (!["idle", "ended", "error"].includes(playback)) active = playback === "paused" ? "Waiting for playback to stop. Paused playback is still active." : "Waiting for playback to stop.";
      if (active) { activity(); return active; }
      const remaining = Math.max(0, idleWindow - (now() - since));
      return remaining ? `Waiting for ten continuous idle minutes. ${Math.ceil(remaining / 1000)} seconds remaining.` : null;
    },
  };
}
