// Run after reloading an idle, paired TV with no pointer or key input. Use a second
// paired controller and a finite video; see docs/native-tv.md#browser-regression.
import type { Action, NavigationKey, SessionState } from "../src/shared/protocol";

declare global {
  interface Window {
    runTvPlaybackFocusRegression: (fixture: { token: string; deviceId: string; targetDeviceId: string; source: string }, revealEarly?: boolean) => Promise<void>;
  }
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const until = async (condition: () => boolean, timeout = 10_000) => {
  for (let attempt = 0; attempt < timeout / 100; attempt++) { if (condition()) return; await wait(100); }
  throw new Error("Playback fixture did not settle");
};

window.runTvPlaybackFocusRegression = async (fixture, revealEarly = false) => {
  assert(document.body.classList.contains("tv-presentation"), "Use the TV override");
  assert(location.pathname === "/" && !document.documentElement.hasAttribute("data-keyboard"), "Reload idle Home without input first");
  const url = new URL("/api/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", fixture.token);
  url.searchParams.set("device", fixture.deviceId);
  const remote = new WebSocket(url);
  let state: SessionState | undefined;
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  remote.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === "state") state = message.state;
    const request = pending.get(message.requestId);
    if (request) { pending.delete(message.requestId); if (message.error) request.reject(new Error(message.error)); else request.resolve(); }
  };
  const command = (action: Action) => new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    pending.set(requestId, { resolve, reject });
    remote.send(JSON.stringify({ type: "command", requestId, action }));
  });
  const band = () => document.querySelector<HTMLElement>("[data-player-band]");
  const focused = (selector: string) => !!document.activeElement?.matches(selector);
  const key = async (key: NavigationKey) => {
    await command({ type: "navigate", key, deviceId: fixture.targetDeviceId });
    await wait(350);
  };
  try {
    await new Promise<void>((resolve, reject) => { remote.onopen = () => resolve(); remote.onerror = () => reject(new Error("Controller connection failed")); });
    await command({ type: "enqueue", entry: { id: crypto.randomUUID(), title: "Focus regression", source: fixture.source }, playNow: true, deviceId: fixture.targetDeviceId });
    await until(() => location.pathname === "/now" && state?.player.status === "playing");
    await wait(200);
    assert(focused("[data-player-surface]"), "Unattended Play must start on the picture");
    if (!revealEarly) await wait(4500);
    const video = document.querySelector("video");
    assert(video && !video.paused && video.currentTime > 0 && state?.player.status === "playing", "Remote Play unexpectedly paused playback");
    assert(band()?.dataset.playerBand === (revealEarly ? "shown" : "hidden"), `Remote Play pinned controls: focus=${document.activeElement?.getAttribute("aria-label")}, focus-visible=${document.activeElement?.matches(":focus-visible")}`);
    assert(!focused('[aria-label="Pause"]'), "Remote Play left Pause focused");
    await key("select");
    assert(focused('[aria-label="Pause"]') && state?.player.status === "playing", "First remote OK must reveal Pause without activating it");
    await wait(4500);
    assert(band()?.dataset.playerBand === "shown" && focused('[aria-label="Pause"]'), "Deliberate remote focus must keep controls visible");
    await key("select");
    await until(() => state?.player.status === "paused");
    await key("select");
    await until(() => state?.player.status === "playing");
    await until(() => !!state?.player.seekable);
    await key("back");
    assert(band()?.dataset.playerBand === "hidden", "Back must hide controls");
    await key("up");
    assert(focused('[role="slider"][aria-label="Playback position"]'), "Remote Up must reveal the timeline");
    await key("down");
    assert(focused('[aria-label="Pause"]'), "Remote Down must return to transport");
    const nextId = crypto.randomUUID();
    await command({ type: "enqueue", entry: { id: nextId, title: "Next focus regression", source: fixture.source } });
    for (const label of ["Volume", "Playback", "Up next"]) {
      const trigger = document.querySelector<HTMLButtonElement>(`.player-page button[aria-label="${label}"]`)!;
      trigger.focus();
      await key("select");
      assert(trigger.getAttribute("aria-expanded") === "true" && document.activeElement !== trigger, `${label} must take focus`);
      if (label === "Up next") {
        const options = document.querySelector<HTMLButtonElement>('[data-player-queue] button[aria-label="Options for Next focus regression"]')!;
        options.focus();
        await key("select");
        assert(document.activeElement?.closest('[role="menu"]'), "The queue menu must take remote focus");
        await key("back");
        assert(document.activeElement === options, "The queue menu must restore its opener");
      }
      await key("back");
      assert(document.activeElement === trigger && trigger.getAttribute("aria-expanded") === "false", `${label} must restore its opener`);
    }
    // Queue advancement uses the same player without another input or a route change.
    await key("back");
    await until(() => state?.currentEntryId === nextId && state.player.status === "playing", (video!.duration + 10) * 1000)
      .catch(() => { throw new Error(`Queue did not advance to ${nextId}: ${state?.currentEntryId}, ${state?.player.status}`); });
    await wait(4500);
    assert(band()?.dataset.playerBand === "hidden" && !document.querySelector("video")?.paused, "Automatic queue advancement must keep playing with idle controls");
  } finally { remote.close(); }
};
