// Import on an empty Vite fixture with #fixture; run on desktop, phone and TV viewports.
import { mountUiAudit } from "./ui-audit.browser";

const wait = () => new Promise(resolve => setTimeout(resolve, 180));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const recognition = () => document.querySelector<HTMLElement>("[data-radio-recognition]");
const controls = () => document.querySelector<HTMLElement>("[data-radio-recognition-controls]");
const button = (label: string) => [...controls()!.querySelectorAll<HTMLButtonElement>("button")].find(button => (button.getAttribute("aria-label") || button.textContent?.trim()) === label)!;
const artworkUrl = "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/0c/72/a1/0c72a174-9208-6c86-e479-79865376e904/19UMGIM66006.rgb.jpg/400x400cc.jpg";
const matched = (title = "Identified song") => Response.json({ track: { title, artist: "Recognized artist", album: "Recognized album", artworkUrl, provider: "shazam", url: "https://www.shazam.com/song/123/identified-song" }, sampledAt: Date.now() });

export async function runRadioRecognitionRegression() {
  const audit = await mountUiAudit();
  const originalFetch = window.fetch;
  const calls: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  window.fetch = (input, init) => new URL(String(input), location.href).pathname === "/api/radio/recognize"
    ? new Promise<Response>(resolve => calls.push({ init, resolve }))
    : originalFetch(input, init);
  const checks: string[] = [];
  const check = async (name: string, run: () => Promise<void>) => { await run(); checks.push(name); };
  async function start() {
    button("Identify song").click();
    await wait();
    return calls.at(-1)!;
  }
  try {
    await check("opening and updating radio never starts recognition", async () => {
      await audit.go("/now", { player: "playing", live: true });
      assert(button("Identify song") && !button("Identify song").disabled, "The radio player lacks its action");
      assert(controls()?.closest("[data-player-header]"), "The action is outside the player's header controls");
      assert(!recognition(), "Opening the player adds an empty result");
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player, position: 10 } } }));
      assert(calls.length === 0, "Recognition started without a click");
    });
    await check("one authenticated click identifies without changing playback or programme", async () => {
      const commands = audit.actions.length;
      const call = await start();
      assert(calls.length === 1 && call.init?.method === "POST", "The click did not make exactly one POST");
      assert(new Headers(call.init?.headers).get("authorization") === "Bearer visual-fixture", "The request lost authentication");
      assert(JSON.parse(String(call.init?.body)).stationId === "audit-radio", "The request identified another station");
      assert(button("Identifying…").disabled && button("Cancel"), "Pending recognition has no usable cancellation");
      button("Cancel").focus();
      call.resolve(matched()); await wait();
      assert(recognition()?.querySelector('[data-slot="item-title"]')?.textContent === "Identified song", "The matched track is missing");
      assert(recognition()?.textContent?.includes("Recognized artist") && recognition()?.textContent?.includes("Recognized album"), "The artist or album is missing");
      assert(recognition()?.querySelector("img")?.src === artworkUrl, "The cover image is missing");
      assert(recognition()?.querySelector("time")?.dateTime, "The result has no sample time");
      assert(!recognition()?.querySelector("a"), "Recognition sends the viewer to another service");
      assert(document.querySelector("h1")?.textContent === "Early Bird", "Recognition overwrote the programme title");
      assert(audit.actions.length === commands, "Recognition sent a playback command");
      assert(document.activeElement === button("Identify song"), "Completion lost focus when Cancel disappeared");
    });
    await check("a match without artwork, album or artist still has an in-Couch result", async () => {
      (await start()).resolve(Response.json({ track: { title: "A title only", provider: "shazam" }, sampledAt: Date.now() })); await wait();
      assert(recognition()?.querySelector('[data-slot="item-title"]')?.textContent === "A title only", "A sparse match lost its title");
      assert(recognition()?.querySelector('[data-slot="item-media"] .media-artwork'), "A sparse match has no cover fallback");
      assert(!recognition()?.querySelector("img, a"), "A sparse match has a broken image or external link");
    });
    await check("a miss and an upstream failure can be retried manually", async () => {
      (await start()).resolve(Response.json({ track: null, sampledAt: Date.now() })); await wait();
      assert(recognition()?.textContent?.includes("No song identified"), "A no-match result is missing");
      assert(!recognition()?.textContent?.includes("Recognized artist"), "A miss retained the old song");
      (await start()).resolve(Response.json({ error: "Recognition is unavailable. Try again." }, { status: 503 })); await wait();
      assert(recognition()?.querySelector('[role="alert"]')?.textContent?.includes("Recognition is unavailable"), "The provider error is missing");
      const before = calls.length;
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player, position: 20 } } }));
      assert(calls.length === before, "Failure retried automatically");
      (await start()).resolve(matched("Retried song")); await wait();
      assert(recognition()?.textContent?.includes("Retried song") && !recognition()?.querySelector('[role="alert"]'), "Retry did not replace the error");
    });
    await check("Cancel aborts the request and ignores a late result", async () => {
      const call = await start();
      button("Cancel").focus(); button("Cancel").click(); await wait();
      assert(call.init?.signal?.aborted, "Cancel did not abort the request");
      call.resolve(matched("Canceled song")); await wait();
      assert(!recognition(), "A canceled result appeared or left an empty result");
      assert(document.activeElement === button("Identify song"), "Cancel lost focus when it disappeared");
    });
    await check("switching station or playback discards pending work", async () => {
      const stationRequest = await start();
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, queue: gate.state!.queue.map(entry => entry.id === "concert" ? { ...entry, source: "radio:other-station" } : entry) } }));
      assert(stationRequest.init?.signal?.aborted, "Switching station did not cancel recognition");
      stationRequest.resolve(matched("Previous station")); await wait();
      assert(!recognition()?.textContent?.includes("Previous station"), "The new station shows an old result");
      const playbackRequest = await start();
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player, playbackId: "replacement" } } }));
      assert(playbackRequest.init?.signal?.aborted, "A new playback kept the old lookup");
      playbackRequest.resolve(matched("Previous playback")); await wait();
      assert(!recognition()?.textContent?.includes("Previous playback"), "The new playback shows an old result");
    });
    await check("saved radio favorites queued by stream URL can be identified", async () => {
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, queue: gate.state!.queue.map(entry => entry.id === "concert" ? { ...entry, source: "https://stream.example.com/nts" } : entry) } }));
      const call = await start();
      assert(JSON.parse(String(call.init?.body)).stationId === "audit-radio", "The saved stream lost its station ID");
      call.resolve(matched("Saved favorite")); await wait();
      assert(recognition()?.textContent?.includes("Saved favorite"), "A saved directory station could not be identified");
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, queue: gate.state!.queue.map(entry => entry.id === "concert" ? { ...entry, source: "https://unsaved.example/stream" } : entry) } }));
      assert(!controls(), "An unsaved stream offers recognition");
      await audit.go("/now", { player: "playing", live: true });
    });
    await check("switching Couch cancels the old request and uses the new credentials", async () => {
      const previous = await start();
      await audit.updateSession(gate => ({ ...gate, credentials: { ...gate.credentials!, origin: "https://another.couch.example", token: "replacement-token" } }));
      assert(previous.init?.signal?.aborted, "Switching Couch did not abort its lookup");
      previous.resolve(matched("Previous Couch")); await wait();
      assert(!recognition()?.textContent?.includes("Previous Couch"), "The new Couch shows the previous result");
      const next = await start();
      assert(new Headers(next.init?.headers).get("authorization") === "Bearer replacement-token", "The new Couch used the previous credentials");
      next.resolve(matched()); await wait();
    });
    await check("disconnect and leaving the player cancel without restarting", async () => {
      const disconnected = await start();
      await audit.updateSession(gate => ({ ...gate, connected: false }));
      assert(disconnected.init?.signal?.aborted && button("Identify song").disabled, "Disconnect left an active lookup");
      disconnected.resolve(matched("Disconnected song")); await wait();
      await audit.updateSession(gate => ({ ...gate, connected: true }));
      assert(!recognition()?.textContent?.includes("Disconnected song"), "Reconnect resurrected an old song");
      const leaving = await start();
      await audit.go("/saved");
      assert(leaving.init?.signal?.aborted, "Leaving the player did not abort");
      leaving.resolve(matched()); await wait();
      const before = calls.length;
      await audit.go("/now", { player: "playing", live: true });
      assert(calls.length === before, "Returning to the player restarted recognition");
      assert(!recognition()?.querySelector("time"), "Returning restored an obsolete result");
    });
    await check("non-radio playback has no recognition action", async () => {
      await audit.go("/now", { player: "playing" });
      assert(!controls(), "A non-radio item offers radio recognition");
    });
    return { passed: true, checks };
  } finally {
    window.fetch = originalFetch;
    audit.close();
  }
}
