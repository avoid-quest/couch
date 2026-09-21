import { remoteSocketUrl } from "./build";
import { strict as assert } from "node:assert";
import type { Action, SessionState } from "../../src/shared/protocol";
import type { RadioStation } from "../../src/shared/radio";
import { assertResponsive, type UiDriver, type Wait } from "./ui";
import { changedRadioTitle, initialRadioTitle, suppliedRadioArtist, type RadioFixture, type RadioMode } from "./radio-fixture";

export type RadioContext = {
  origin: string;
  ui: UiDriver;
  until: Wait;
  clients: readonly { token: string; state: SessionState | null; command: (action: Action) => Promise<void> }[];
  api: (path: string, body?: unknown, index?: number) => Promise<any>;
  httpRemote: { ui: UiDriver; restore: () => Promise<unknown>; minimize: () => Promise<unknown>; screenshot: (name: string) => Promise<void> };
  artifactDir: string;
};

export async function verifyRadio(context: RadioContext, fixture: RadioFixture) {
  const { origin, ui, until, clients, api, httpRemote, artifactDir } = context;
  const first = () => clients[0]!.state!;
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => client.state && predicate(client.state));
  const originalQueue = structuredClone(first().queue);
  const stations: RadioStation[] = [];
  const observations: { at: number; position: number; entryId: string | null; playbackId: string | null; status: SessionState["player"]["status"]; nowPlaying: SessionState["player"]["nowPlaying"]; retry: SessionState["radioRetry"] }[] = [];
  const cancellations: unknown[] = [];
  let last = "";
  const observe = setInterval(() => {
    const state = clients[0]?.state;
    if (!state) return;
    const value = { entryId: state.currentEntryId, playbackId: state.player.playbackId, status: state.player.status, nowPlaying: state.player.nowPlaying ?? null, retry: state.radioRetry ?? null };
    const encoded = JSON.stringify({ ...value, second: Math.floor(state.player.position) });
    if (encoded !== last) { observations.push({ at: Date.now(), position: state.player.position, ...value }); last = encoded; }
  }, 50);
  const write = () => Bun.write(`${artifactDir}/radio-reliability.json`, JSON.stringify({
    date: new Date().toISOString(), source: fixture.source, requests: fixture.requests(), observations, cancellations,
    note: "Actual native libmpv HTTP requests and observations with a paced MP3/ICY fixture. Software rendering and silent PulseAudio output do not qualify physical audio or Wi-Fi reliability.",
  }, null, 2));
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("radio Stop clears playback, current-track metadata and pending retries on both controllers", () => all(state => state.player.status === "idle" && state.currentEntryId === null && !state.radioRetry && !state.player.nowPlaying));
  };
  const addStation = async (mode: RadioMode, name: string, artist?: string) => {
    const stream = fixture.add(mode, artist);
    const station: RadioStation = { id: crypto.randomUUID(), name, url: stream.url, homepage: null, countryCode: "IT", codec: "MP3", bitrate: 64, groupTitle: "Reliability fixtures" };
    await api("/api/radio/favorites", { station });
    stations.push(station);
    await until(`${name} favorite is shared with the other controller`, async () => (await api("/api/radio/favorites", undefined, 1)).favorites.some((item: RadioStation) => item.id === station.id && item.groupTitle === station.groupTitle && item.logoUrl === station.logoUrl));
    return { ...stream, station };
  };
  const enqueue = async (station: RadioStation, playNow = true) => {
    const entryId = crypto.randomUUID();
    await clients[0]!.command({ type: "enqueueRadio", stationId: station.id, entryId, playNow });
    return entryId;
  };
  const playing = (entryId: string) => all(state => state.currentEntryId === entryId && state.player.status === "playing" && state.player.tracks?.some(track => track.kind === "audio") === true);
  // Radio clock-only ticks intentionally do not broadcast. New subscribers
  // receive the coordinator's current native observation.
  const advancing = async (entryId: string) => {
      const NativeWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
      const socket = new NativeWebSocket(await remoteSocketUrl(origin, clients[0]!.token), { headers: { origin } });
      return await new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error("Radio snapshot timed out")); }, 5_000);
        socket.onmessage = event => {
          const message = JSON.parse(String(event.data));
          if (message.type !== "state") return;
          clearTimeout(timer); socket.close();
          const state = message.state as SessionState;
          observations.push({ at: Date.now(), position: state.player.position, entryId: state.currentEntryId, playbackId: state.player.playbackId, status: state.player.status, nowPlaying: state.player.nowPlaying ?? null, retry: state.radioRetry ?? null });
          resolve(message.state.currentEntryId === entryId && message.state.player.position > 0.25);
        };
      });
  };
  const backoff = (entryId: string, attempt = 1) => all(state => state.currentEntryId === entryId && state.player.status === "loading" && state.radioRetry?.attempt === attempt && typeof state.radioRetry.retryAt === "number" && state.radioRetry.retryAt > Date.now());
  const unchangedAfterDeadline = async (key: string, count: number, retryAt: number, action: string) => {
    await Bun.sleep(Math.max(0, retryAt - Date.now()) + 350);
    assert.equal(fixture.requests(key).length, count, `${action} cancels the pending native HTTP request`);
    cancellations.push({ action, key, requests: count, retryAt, checkedAt: Date.now() });
    await until(`${action} leaves no pending radio reconnect`, () => all(state => !state.radioRetry));
  };
  try {
    await stop();
    const metadata = await addStation("metadata", "Acceptance changing radio", suppliedRadioArtist);
    const plain = await addStation("plain", "Acceptance untagged radio");
    await httpRemote.minimize();
    await ui.section("Saved");
    await ui.button(`Play ${metadata.station.name}`);
    let metadataEntryId = "";
    await until("TV station Play receives native ICY title and a genuinely supplied artist on both controllers", () => {
      metadataEntryId = first().currentEntryId ?? "";
      return !!metadataEntryId && playing(metadataEntryId) && all(state => state.queue.find(entry => entry.id === metadataEntryId)?.title === metadata.station.name && state.player.nowPlaying?.title === initialRadioTitle && state.player.nowPlaying.artist === suppliedRadioArtist);
    }, 25_000);
    await until("native radio clock advances in a fresh authoritative snapshot", () => advancing(metadataEntryId));
    const playbackId = first().player.playbackId;
    await ui.section("Now");
    // Current TV artwork keeps the station title; native ICY metadata is asserted
    // in both session snapshots above and below, independently of presentation.
    await httpRemote.restore();
    await httpRemote.ui.section("Now");
    await until("paired HTTP phone displays the playing station", async () => await httpRemote.ui.execute("return document.querySelector('.media-title')?.textContent === arguments[0]", [metadata.station.name]));
    await until("phone displays native ICY title and artist", async () => await httpRemote.ui.execute("return document.querySelector('.radio-now-playing')?.textContent === arguments[0]", [`${suppliedRadioArtist} · ${initialRadioTitle}`]));
    fixture.setTitle(metadata.key, changedRadioTitle);
    await until("a second ICY title updates while the same native playback continues", () => all(state => state.player.playbackId === playbackId && state.player.nowPlaying?.title === changedRadioTitle && state.player.nowPlaying.artist === suppliedRadioArtist && state.queue.find(entry => entry.id === metadataEntryId)?.title === metadata.station.name), 15_000);
    await until("phone displays the changed native ICY title", async () => await httpRemote.ui.execute("return document.querySelector('.radio-now-playing')?.textContent === arguments[0]", [`${suppliedRadioArtist} · ${changedRadioTitle}`]));
    for (const driver of [ui, httpRemote.ui]) assert.equal(await driver.execute("return !!document.querySelector('[data-radio-fixture]')"), false, "Radio metadata never inserts HTML");
    await assertResponsive(httpRemote.ui, "Phone radio current track");
    await httpRemote.screenshot("http-radio-metadata");
    assert.ok(fixture.requests(metadata.key).every(request => request.icy), "Native mpv explicitly requests ICY metadata");

    await httpRemote.ui.section("Saved");
    await httpRemote.ui.button(`Play ${plain.station.name}`);
    await httpRemote.ui.section("Now");
    let plainEntryId = "";
    await until("phone station replacement plays an untagged stream and clears previous track metadata", () => {
      plainEntryId = first().currentEntryId ?? "";
      return !!plainEntryId && plainEntryId !== metadataEntryId && playing(plainEntryId) && all(state => !state.player.nowPlaying && !state.radioRetry);
    }, 25_000);
    for (const driver of [ui, httpRemote.ui]) await until("untagged radio has no stale current-track label", async () => await driver.execute("return !document.querySelector('.radio-now-playing')"));
    const ordinary = originalQueue.find(entry => entry.source === "http://127.0.0.1:4200/multitrack.mkv");
    assert.ok(ordinary, "Ordinary multitrack fixture remains available for radio source cleanup");
    await clients[1]!.command({ type: "play", entryId: ordinary.id, fromStart: true });
    await until("ordinary video playback after radio clears stream metadata and retry state", () => playing(ordinary.id) && all(state => !state.player.nowPlaying && !state.radioRetry && state.player.tracks?.filter(track => track.kind === "audio").length === 2));
    await stop();

    const flaky = await addStation("flaky", "Acceptance recovered radio");
    const flakyEntryId = await enqueue(flaky.station);
    await until("a failed radio request reconnects to native audio without changing its queue occurrence", () => playing(flakyEntryId) && fixture.requests(flaky.key).length === 2, 25_000);
    const recoveredRequests = fixture.requests(flaky.key);
    assert.deepEqual(recoveredRequests.map(request => request.status), [503, 200]);
    assert.ok(recoveredRequests[1]!.at - recoveredRequests[0]!.at >= 800, "The first reconnect respects the one-second backoff");
    await stop();

    const failed = await addStation("failed", "Acceptance unavailable radio");
    const failedEntryId = await enqueue(failed.station);
    await until("radio exhausts exactly three reconnect attempts with a stable useful failure", () => all(state => state.currentEntryId === failedEntryId && state.player.status === "error" && !!state.player.error && state.radioRetry?.attempt === 3 && state.radioRetry.maximum === 3 && state.radioRetry.retryAt === null && !state.player.nowPlaying), 30_000);
    const failedRequests = fixture.requests(failed.key);
    assert.equal(failedRequests.length, 4, "One initial native request plus three bounded retries");
    for (let index = 1; index < 4; index++) assert.ok(failedRequests[index]!.at - failedRequests[index - 1]!.at >= [800, 1_800, 3_800][index - 1]!, `Retry ${index} respects its increasing delay`);
    await Bun.sleep(4_350);
    assert.equal(fixture.requests(failed.key).length, 4, "Exhausted radio does not continue retrying in mpv or Bun");
    for (const driver of [ui, httpRemote.ui]) await until("TV and phone offer Try again after bounded radio failure", async () => await driver.execute("return document.querySelector('.radio-retry')?.textContent.includes('3') && [...document.querySelectorAll('.radio-retry button')].some(button => button.textContent.trim() === 'Try again' && !button.disabled)"));
    await assertResponsive(httpRemote.ui, "Phone radio retry failure");
    await httpRemote.screenshot("http-radio-failed");
    fixture.recover(failed.key);
    await httpRemote.ui.button("Try again", ".radio-retry");
    await until("phone Try again resets the exhausted budget and starts the same station", () => playing(failedEntryId) && fixture.requests(failed.key).length === 5 && all(state => !state.radioRetry), 25_000);
    await stop();

    const stopped = await addStation("failed", "Acceptance stopped reconnect");
    const stoppedEntryId = await enqueue(stopped.station);
    await until("radio exposes a pending four-second reconnect before phone Stop", () => backoff(stoppedEntryId, 3), 20_000);
    const stopAt = first().radioRetry!.retryAt!;
    const stopCount = fixture.requests(stopped.key).length;
    await httpRemote.ui.button("Stop playback");
    await until("phone Stop cancels radio backoff immediately on both controllers", () => all(state => state.player.status === "idle" && !state.radioRetry && !state.player.nowPlaying));
    await unchangedAfterDeadline(stopped.key, stopCount, stopAt, "Phone Stop");

    const replaced = await addStation("failed", "Acceptance replaced reconnect");
    const replacedEntryId = await enqueue(replaced.station);
    await until("radio has a pending reconnect before another controller replaces it", () => backoff(replacedEntryId, 3), 20_000);
    const replaceAt = first().radioRetry!.retryAt!;
    const replaceCount = fixture.requests(replaced.key).length;
    await clients[1]!.command({ type: "play", entryId: plainEntryId });
    await until("another controller replaces the retrying station with native playback", () => playing(plainEntryId) && all(state => !state.radioRetry), 25_000);
    await unchangedAfterDeadline(replaced.key, replaceCount, replaceAt, "Source replacement");
    await stop();

    for (const mode of ["eof", "disconnect", "stall"] as const) {
      const broken = await addStation(mode, `Acceptance ${mode} radio`);
      const brokenEntryId = await enqueue(broken.station, false);
      // A following playable item makes accidental automatic queue advance visible.
      await enqueue(plain.station, false);
      await clients[0]!.command({ type: "play", entryId: brokenEntryId });
      if (mode !== "stall") await until(`native radio ${mode} advances before disconnecting`, () => advancing(brokenEntryId));
      await until(`native radio ${mode} reaches a bounded reconnect without advancing the queue`, () => backoff(brokenEntryId) && fixture.requests(broken.key).length === 1, mode === "stall" ? 30_000 : 20_000);
      if (mode !== "stall") assert.ok(observations.some(value => value.entryId === brokenEntryId && value.status === "playing" && value.position > 0), `${mode} disconnect follows observed native playback`);
      const retryAt = first().radioRetry!.retryAt!;
      await stop();
      await unchangedAfterDeadline(broken.key, 1, retryAt, `Stop after ${mode}`);
    }
    assert.ok(fixture.requests().every(request => !request.credentials), "Radio fixture requests never inherit Jellyfin or controller credentials");
  } finally {
    clearInterval(observe);
    await write();
    await stop();
    const originalIds = new Set(originalQueue.map(entry => entry.id));
    for (const entry of [...first().queue]) if (!originalIds.has(entry.id)) await clients[0]!.command({ type: "remove", entryId: entry.id });
    for (const station of stations) {
      const response = await fetch(`${origin}/api/radio/favorites/${station.id}`, { method: "DELETE", headers: { origin, authorization: `Bearer ${clients[0]!.token}` } });
      assert.equal(response.status, 204);
    }
    await until("radio acceptance preserves the existing queue identities and order", () => all(state => JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(originalQueue.map(entry => entry.id))));
    await httpRemote.restore();
    await httpRemote.ui.section("Queue");
    await httpRemote.minimize();
    await ui.section("Queue");
  }

  const shutdown = fixture.add("failed");
  const shutdownEntry = { id: crypto.randomUUID(), title: "Acceptance shutdown reconnect", source: shutdown.url, kind: "radio" as const };
  let shutdownCount = 0;
  let shutdownRetryAt = 0;
  let shutdownQueueIds: string[] = [];
  return {
    async prepareShutdown() {
      shutdownQueueIds = first().queue.map(entry => entry.id);
      await clients[0]!.command({ type: "enqueue", entry: shutdownEntry, playNow: true });
      await until("native radio has a pending reconnect when the desktop closes", () => backoff(shutdownEntry.id, 3), 20_000);
      shutdownCount = fixture.requests(shutdown.key).length;
      shutdownRetryAt = first().radioRetry!.retryAt!;
    },
    async assertShutdown() {
      await Bun.sleep(Math.max(0, shutdownRetryAt - Date.now()) + 350);
      assert.equal(fixture.requests(shutdown.key).length, shutdownCount, "Desktop shutdown cancels the pending radio reconnect");
      cancellations.push({ action: "Desktop shutdown", key: shutdown.key, requests: shutdownCount, retryAt: shutdownRetryAt, checkedAt: Date.now() });
      await write();
    },
    async assertAfterRestart() {
      await until("desktop restart retains the radio entry without playback, old metadata or reconnect timers", () => all(state => state.player.status === "idle" && state.currentEntryId === null && !state.player.nowPlaying && !state.radioRetry && state.queue.some(entry => entry.id === shutdownEntry.id && entry.kind === "radio")));
      assert.equal(fixture.requests(shutdown.key).length, shutdownCount, "Restart does not retry the previous radio stream");
      await clients[0]!.command({ type: "remove", entryId: shutdownEntry.id });
      await until("radio shutdown acceptance restores the original persisted queue", () => all(state => JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(shutdownQueueIds)));
      await write();
    },
  };
}
