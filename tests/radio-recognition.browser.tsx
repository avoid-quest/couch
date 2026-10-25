// Import on an empty Vite fixture with #fixture; run on desktop, phone and TV viewports.
import { mountUiAudit } from "./ui-audit.browser";

const wait = () => new Promise(resolve => setTimeout(resolve, 180));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const recognition = () => document.querySelector<HTMLElement>("[data-radio-recognition]");
const controls = () => document.querySelector<HTMLElement>("[data-radio-recognition-controls]");
const button = (label: string) => [...controls()!.querySelectorAll<HTMLButtonElement>("button")].find(button => (button.getAttribute("aria-label") || button.textContent?.trim()) === label)!;
const artworkUrl = "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/0c/72/a1/0c72a174-9208-6c86-e479-79865376e904/19UMGIM66006.rgb.jpg/400x400cc.jpg";
const observation = { id: "lookup-1", station: { id: "audit-radio", name: "NTS Radio" }, programme: "Early Bird", requestedBy: { deviceId: "studio-browser", name: "Studio browser" } };
const matched = (title = "Identified song") => Response.json({ ...observation, id: crypto.randomUUID(), track: { title, artist: "Recognized artist", album: "Recognized album", artworkUrl, provider: "shazam", url: "https://www.shazam.com/song/123/identified-song" }, sampledAt: Date.now() });

export async function runRadioRecognitionRegression() {
  const audit = await mountUiAudit();
  const originalFetch = window.fetch;
  const history: unknown[] = [];
  const calls: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  window.fetch = (input, init) => new URL(String(input), location.href).pathname === "/api/radio/recognize"
    ? new Promise<Response>(resolve => calls.push({ init, resolve: response => {
      if (response.ok) void response.clone().json().then(entry => { history.unshift(entry); resolve(response); });
      else resolve(response);
    } }))
    : new URL(String(input), location.href).pathname === "/api/radio/recognitions" ? Promise.resolve(Response.json({ items: history })) : originalFetch(input, init);
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
      assert(recognition()?.querySelector('[data-recognition-title]')?.textContent === "Identified song", "The matched track is missing");
      assert(recognition()?.textContent?.includes("Recognized artist"), "The artist is missing");
      assert(recognition()?.querySelector("img")?.src === artworkUrl, "The cover image is missing");
      assert(recognition()?.querySelector("time")?.dateTime, "The result has no sample time");
      assert(!recognition()?.querySelector('a[href*="shazam.com"]'), "Recognition sends the viewer to another service");
      assert(document.querySelector("h1")?.textContent === "Early Bird", "Recognition overwrote the programme title");
      assert(audit.actions.length === commands, "Recognition sent a playback command");
      assert(document.activeElement === button("Identify song"), "Completion lost focus when Cancel disappeared");
    });
    await check("the found song searches all Couch sources directly without a modal", async () => {
      const info = document.querySelector<HTMLButtonElement>('button[aria-label="Info"]')!;
      info.click(); await wait();
      const link = recognition()?.querySelector<HTMLAnchorElement>('a[aria-label="Search Couch for Recognized artist Identified song"]')!;
      assert(link && document.querySelector('#player-info:not([hidden])'), "Result and full Info are not both visible");
      assert(!!(recognition()!.compareDocumentPosition(document.querySelector('#player-info')!) & Node.DOCUMENT_POSITION_FOLLOWING), "The found song is mixed into the next programme");
      assert(recognition()?.querySelector('button[aria-label="Clear result"]') && recognition()?.querySelectorAll("svg").length === 1, "The result must keep only the clear cross, with no chevron");
      const commands = audit.actions.length;
      link.click(); await wait();
      const url = new URL(audit.router.state.location.href, location.href);
      assert(url.pathname === "/search" && url.searchParams.get("q") === "Recognized artist Identified song", "The result did not search its artist and title");
      assert(!url.searchParams.has("source") && !url.searchParams.has("kind"), "The song search excludes available sources");
      assert(!document.querySelector('[role="dialog"]'), "A song search opened a modal");
      assert((document.querySelector('#media-search') as HTMLInputElement)?.value === "Recognized artist Identified song", "The header did not receive the search hint");
      for (const provider of ["youtube", "bandcamp", "soundcloud"]) assert(audit.calls.some(path => path.startsWith(`/api/providers/${provider}/items?`) && new URL(path, location.href).searchParams.get("q") === "Recognized artist Identified song"), `The song was not searched on ${provider}`);
      assert(audit.actions.length === commands, "Searching the song changed playback");
      await audit.go("/now", { player: "playing", live: true });
      (await start()).resolve(matched()); await wait();
    });
    await check("clearing the result keeps searchable Saved history and its full context", async () => {
      recognition()!.querySelector<HTMLButtonElement>('button[aria-label="Clear result"]')!.click(); await wait();
      assert(!recognition(), "Clear left a found song in the player");
      assert(document.activeElement === button("Identify song"), "Clear lost keyboard focus");
      await audit.router.navigate({ to: "/saved", search: { tab: "identified" } }); await wait();
      const saved = document.querySelector('[aria-label="Identified songs"]');
      const row = saved?.querySelector<HTMLAnchorElement>('a[aria-label="Search Couch for Recognized artist Identified song"]');
      assert(row && saved?.textContent?.includes("NTS Radio") && saved.textContent?.includes("Early Bird") && saved.querySelector("time"), "Saved history lost the song or context");
      assert(saved?.textContent?.includes("Recognized album") && saved.textContent?.includes("Requested by Studio browser"), "History lost the album or requester");
      row!.click(); await wait();
      assert(new URL(audit.router.state.location.href, location.href).searchParams.get("q") === "Recognized artist Identified song" && !document.querySelector('[role="dialog"]'), "History does not link directly to Couch search");
      await audit.go("/now", { player: "playing", live: true });
      assert(!recognition(), "Returning from history restored the cleared result");
    });
    await check("a match without artwork, album or artist still has an in-Couch result", async () => {
      (await start()).resolve(Response.json({ ...observation, id: crypto.randomUUID(), track: { title: "A title only", provider: "shazam" }, sampledAt: Date.now() })); await wait();
      assert(recognition()?.querySelector('[data-recognition-title]')?.textContent === "A title only", "A sparse match lost its title");
      assert(recognition()?.querySelector('.media-artwork'), "A sparse match has no cover fallback");
      assert(!recognition()?.querySelector("img"), "A sparse match has a broken image");
      const sparse = recognition()?.querySelector<HTMLAnchorElement>("a");
      assert(sparse && new URL(sparse.href).searchParams.get("q") === "A title only", "A title-only match has no usable Couch search");
    });
    await check("a miss and an upstream failure can be retried manually", async () => {
      (await start()).resolve(Response.json({ ...observation, id: crypto.randomUUID(), track: null, sampledAt: Date.now() })); await wait();
      assert(recognition()?.textContent?.includes("No song identified"), "A no-match result is missing");
      assert(!recognition()?.textContent?.includes("Recognized artist"), "A miss retained the old song");
      const clearMiss = recognition()?.querySelector<HTMLButtonElement>('button[aria-label="Clear result"]');
      assert(clearMiss?.querySelector("svg") && !clearMiss.textContent?.trim(), "A miss must use the clear cross without a text button");
      clearMiss!.click(); await wait();
      assert(!recognition() && document.activeElement === button("Identify song"), "Clearing a miss must dismiss it and restore focus");
      (await start()).resolve(Response.json({ error: "Recognition is unavailable. Try again." }, { status: 503 })); await wait();
      assert(recognition()?.querySelector('[role="alert"]')?.textContent?.includes("Recognition is unavailable"), "The provider error is missing");
      const clearError = recognition()?.querySelector<HTMLButtonElement>('button[aria-label="Clear result"]');
      assert(clearError?.querySelector("svg") && !clearError.textContent?.trim(), "An error must use the clear cross without a text button");
      clearError!.click(); await wait();
      assert(!recognition() && document.activeElement === button("Identify song"), "Clearing an error must dismiss it and restore focus");
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
