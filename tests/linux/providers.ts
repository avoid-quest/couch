import { seedConfiguredFixture } from "./configured-fixture";
seedConfiguredFixture();
import { remoteSocketUrl } from "./build";
import { strict as assert } from "node:assert";
import type { Action, QueueEntry, ServerMessage, SessionState } from "../../src/shared/protocol";
import type { ProviderId, ProviderItem } from "../../src/shared/providers";
import { UiDriver, keys, type startHttpRemote } from "./ui";
import { captureBandcampAudio, verifyBandcamp, verifyBandcampRestart } from "./bandcamp";

type Provider = { name: string; url?: string; kind: "webpage" | "direct"; video: boolean; live?: boolean; observeSeconds?: number; seekPosition?: number; catalog?: { provider: ProviderId; search?: string; open?: string[]; match: string } };
const catalogs = process.env.COUCH_TEST_PROVIDER_CATALOGS === "1";
const providers: Provider[] = catalogs ? [
  { name: "YouTube search Big Buck Bunny", kind: "webpage", video: true, seekPosition: 30, catalog: { provider: "youtube", search: "Big Buck Bunny Blender Foundation", match: "^Big Buck Bunny$" } },
  { name: "Twitch search LofiGirl live", kind: "webpage", video: true, live: true, observeSeconds: 35, catalog: { provider: "twitch", search: "LofiGirl", match: "LofiGirl" } },
  { name: "RaiPlay browse live Rai News 24", kind: "webpage", video: true, live: true, catalog: { provider: "raiplay", open: ["^Dirette TV$"], match: "^Rai News ?24$" } },
  { name: "RaiPlay browse news program episode", kind: "webpage", video: true, catalog: { provider: "raiplay", open: ["^L'informazione Rai$", "^RaiNews$", "^Rai News - Puntate$"], match: "^RaiNews24$" } },
  { name: "RaiPlay search RaiNews24 replay", kind: "webpage", video: true, catalog: { provider: "raiplay", search: "RaiNews24", match: "RaiNews24" } },
  { name: "RaiPlay browse recent replay", kind: "webpage", video: true, catalog: { provider: "raiplay", open: ["^Replay - ultimi 7 giorni$", "^\\d{2}/\\d{2}/\\d{4}$", "^Rai News ?24$"], match: "RASSEGNA STAMPA|RaiNews24" } },
  { name: "Bandcamp public Mastodon Hail to Fire", kind: "webpage", video: false, catalog: { provider: "bandcamp", search: "https://relapsealumni.bandcamp.com/track/hail-to-fire", match: "^Hail to Fire$" } },
  { name: "Bandcamp public Blazo Intro", kind: "webpage", video: false, catalog: { provider: "bandcamp", search: "https://blazo.bandcamp.com/track/intro", match: "^Intro$" } },
] : await Bun.file(process.env.COUCH_TEST_PROVIDERS!).json() as Provider[];
const artifacts = "/artifacts/providers";
await Bun.$`mkdir -p ${artifacts}`.quiet();
for (const name of ["versions.txt", "sources.sha256", "binaries.sha256"]) await Bun.write(`${artifacts}/${name}`, Bun.file(`/artifacts/${name}`));
const origin = "http://127.0.0.1:4100";
const driverOrigin = "http://127.0.0.1:4444";
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/driver.log`), stderr: Bun.file(`${artifacts}/native.log`) });
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
let session = "";
let httpRemote: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
const remotes: { token: string; socket: WebSocket; state: SessionState | null }[] = [];
const favorites = new Map<string, ProviderItem>();
const savedMedia = new Map<string, string>();
const results: unknown[] = [];
const previous = await Bun.file(`${artifacts}/native-results.json`).json().catch(() => []) as Record<string, unknown>[];
const provenance = {
  testedAt: new Date().toISOString(), bun: Bun.version,
  rendering: process.env.COUCH_BASIC_RENDERING === "1" ? "libmpv gpu-dumb-mode=yes" : "default libmpv renderer",
  versions: await Bun.file(`${artifacts}/versions.txt`).text(),
  binaries: await Bun.file(`${artifacts}/binaries.sha256`).text(),
};

async function until(check: () => unknown | Promise<unknown>, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error("Native provider check timed out");
    await Bun.sleep(100);
  }
}
async function wd(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`${driverOrigin}${path}`, {
    method, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json() as { value: any };
  if (!response.ok || result.value?.error) throw new Error(`WebDriver ${path}: ${JSON.stringify(result.value ?? response.status)}`);
  return result.value;
}
const ui = new UiDriver(wd, () => session);
const execute = ui.execute;
async function card(pattern: string) {
  let id = "";
  await until(async () => {
    const error = await execute("return document.querySelector('[aria-label="Search media"] [role=alert]')?.textContent");
    if (error) throw new Error(error);
    id = await execute("return [...document.querySelectorAll('[data-hit-id]')].find(row => row.dataset.hitId?.startsWith(arguments[1] + ':') && new RegExp(arguments[0], 'i').test(row.querySelector('[data-play] span')?.textContent || ''))?.getAttribute('data-hit-id') || ''", [pattern, currentProvider]);
    return !!id;
  }, 45_000);
  const selector = `[data-hit-id=${JSON.stringify(id)}]`;
  await execute("document.querySelector(arguments[0]).scrollIntoView({ block: 'center' })", [selector]);
  return selector;
}
let currentProvider: ProviderId = "youtube";
async function api(path: string, index = 0) {
  const response = await fetch(`${origin}${path}`, { headers: { origin, Authorization: `Bearer ${remotes[index]!.token}` }, signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  return response.json() as Promise<any>;
}
async function connect(remote: typeof remotes[number]) {
  remote.state = null;
  remote.socket = new BunWebSocket(await remoteSocketUrl(origin, remote.token), { headers: { origin } });
  remote.socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") remote.state = message.state;
  };
}
function command(index: number, action: Action) {
  remotes[index]!.socket.send(JSON.stringify({ type: "command", requestId: crypto.randomUUID(), action }));
}
async function record(result: Record<string, unknown>) {
  results.push(result);
  const oldIndex = previous.findIndex(old => catalogs ? old.name === result.name && !!old.catalog : old.url === result.url && old.kind === result.kind && !old.catalog);
  if (oldIndex !== -1) previous.splice(oldIndex, 1);
  previous.push({ ...result, ...provenance });
  await Bun.write(`${artifacts}/native-results.json`, JSON.stringify(previous, null, 2));
  await Bun.write(`${artifacts}/native-run-results.json`, JSON.stringify({ ...provenance, cases: results }, null, 2));
}
async function screenshot(name: string) {
  await execute("document.querySelectorAll('[data-pairing-code], .pair-shortcut strong, [data-administrator-code], #administrator-code').forEach(pairing => pairing.style.visibility='hidden')");
  await Bun.sleep(250);
  const capture = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", `${artifacts}/${name}.png`], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await capture.exited, 0);
}

try {
  await until(async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  session = (await wd("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until(async () => await execute("return document.querySelector('[role=status]')?.textContent") === "Connected");
  await ui.button("Settings"); await ui.settingsSection("general");
  await until(async () => await execute("return !!document.querySelector('[data-administrator-code]')"));
  await ui.key(keys.escape);
  await until(async () => !await execute("return !!document.querySelector('[role=dialog]')"));
  await ui.click(".pair-shortcut");
  const code = await execute("return document.querySelector('[data-pairing-code]').textContent");
  await ui.key(keys.escape);
  await until(async () => !await execute("return !!document.querySelector('[role=dialog]')"));
  for (let index = 0; index < 2; index++) {
    const response = await fetch(`${origin}/api/pair`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ code }) });
    assert.equal(response.status, 200);
    const { token } = await response.json() as { token: string };
    const remote = { token, socket: null! as WebSocket, state: null as SessionState | null };
    connect(remote);
    remotes.push(remote);
  }
  await until(() => remotes.every(remote => remote.state));
  if (catalogs) {
    await ui.button("Settings"); await ui.settingsSection("playback");
    await ui.button("720p", '[aria-label="Video quality"]');
    await ui.section("Find");
  }
  for (const [index, provider] of providers.entries()) {
    const name = `${index + 1}-${provider.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const started = performance.now();
    console.log(`START native provider ${provider.name}`);
    let phase = "add media through the native UI";
    let entry: QueueEntry | undefined;
    let result: Record<string, unknown>;
    try {
      if (provider.catalog) {
        const queued = new Set(remotes[0]!.state!.queue.map(item => item.id));
        await ui.section("Find");
        if (provider.catalog.provider === "bandcamp") {
          phase = "paste the public Bandcamp track link";
          await ui.type("#media-search", provider.catalog.search!);
          await until(async () => await execute("return !!document.querySelector('[aria-label=\"Pasted link\"]')"));
          assert.equal(await execute("return !!document.querySelector('[aria-label="Pasted link"] [aria-label="Video quality"]')"), false, "Bandcamp has no video quality control");
          await ui.button("Play", '[aria-label="Pasted link"]');
        } else {
          phase = "find the public provider result";
          currentProvider = provider.catalog.provider;
          const query = provider.catalog.search ?? (provider.catalog.match.includes("RaiNews") ? "RaiNews24" : "Rai News 24");
          await ui.type("#media-search", query);
          const selected = await card(provider.catalog.match);
          if (provider.live) assert.ok(await execute("return document.querySelector(arguments[0])?.textContent.includes('Live')", [selected]), "Live provider result is marked LIVE");
          const title = await execute("return document.querySelector(arguments[0] + ' strong')?.textContent", [selected]);
          const thumbnail = await execute("return document.querySelector(arguments[0] + ' img')?.src", [selected]);
          assert.ok(thumbnail, "Public provider result includes artwork");
          await until(async () => await execute("return document.querySelector(arguments[0] + ' img')?.naturalWidth > 0", [selected]));
          const before = remotes[0]!.state!.versions?.providers ?? 0;
          const collection = await execute("return document.querySelector(arguments[0] + ' [data-play]')?.getAttribute('aria-label')?.startsWith('Open ')", [selected]);
          await execute("document.querySelector(arguments[0] + ' [data-play]').focus()", [selected]);
          if (!await execute("return !!document.querySelector(arguments[0] + ' [aria-label^=\"Saved:\"]')", [selected])) {
            await ui.click(`${selected} [aria-label^="Save:"]`);
            if (collection) await until(() => remotes.every(remote => (remote.state?.versions?.providers ?? 0) > before));
          }
          if (collection) {
            const favorite = (await api("/api/providers/favorites", 1)).favorites.find((item: ProviderItem) => item.provider === provider.catalog!.provider && item.title === title) as ProviderItem | undefined;
            assert.ok(favorite, "Native saved collection reaches the second remote");
            favorites.set(favorite.id, favorite);
          } else {
            await until(async () => (await api("/api/for-later", 1)).items.some((item: { title: string }) => item.title === title));
            savedMedia.set(title, provider.catalog.provider);
          }
          phase = "play the result from Find";
          await ui.click(`${selected} [data-play]`);
          if (collection) await ui.button("Play all", '[aria-label="Search media"] header');
        }
        await until(() => remotes.every(remote => remote.state?.queue.some(item => !queued.has(item.id) && (provider.catalog!.provider === "bandcamp" || item.quality === "720p"))));
        entry = remotes[0]!.state!.queue.find(item => !queued.has(item.id))!;
        provider.url = entry.source.slice(4);
        if (provider.catalog.provider === "bandcamp") {
          assert.equal(provider.url, provider.catalog.search, "Only the original public Bandcamp page reaches paired controllers");
          assert.equal("headers" in entry || "audioSource" in entry || "resolvedSource" in entry, false, "Resolved Bandcamp streams stay on the host");
        }
      } else {
        const queued = new Set(remotes[0]!.state!.queue.map(item => item.id));
        await ui.section("Find");
        await ui.type("#media-search", provider.url!);
        await until(async () => await execute("return !!document.querySelector('[aria-label=\"Pasted link\"]')"));
        if (provider.kind === "direct") await ui.button("Direct media", '[aria-label="Pasted link"]');
        await ui.button("Queue", '[aria-label="Pasted link"]');
        await until(() => remotes.every(remote => remote.state?.queue.some(item => !queued.has(item.id))));
        entry = remotes[0]!.state!.queue.find(item => !queued.has(item.id))!;
        command(0, { type: "play", entryId: entry.id });
      }
      phase = "observe native audio/video playback";
      await until(() => {
        if (remotes.some(remote => remote.state?.currentEntryId === entry!.id && remote.state.player.status === "error")) throw new Error(remotes[0]!.state!.player.error || "Native playback error");
        return remotes.every(remote => remote.state?.currentEntryId === entry!.id && remote.state.player.status === "playing" && remote.state.player.tracks?.some(track => track.kind === "audio") && (!provider.video || remote.state.player.tracks.some(track => track.kind === "video")));
      }, 90_000);
      if (provider.seekPosition !== undefined) {
        command(1, { type: "seek", playbackId: remotes[0]!.state!.player.playbackId!, position: provider.seekPosition });
        await until(() => remotes.every(remote => remote.state!.player.position >= provider.seekPosition! - 0.5));
      }
      const initial = remotes[0]!.state!.player.position;
      phase = "observe advancing playback on both remotes";
      if (provider.observeSeconds) await Bun.sleep(provider.observeSeconds * 1000);
      await until(() => remotes.every(remote => remote.state!.player.status === "playing" && remote.state!.player.position > initial + 2), 90_000);
      phase = "change volume from the second remote";
      command(1, { type: "volume", volume: 41 });
      await until(() => remotes.every(remote => remote.state!.player.volume === 41));
      if (provider.catalog) {
        phase = "show current provider media on the native player";
        await ui.controls();
        await until(async () => await execute("return document.querySelector('[data-player-heading] h1')?.textContent === arguments[0]", [entry!.title]));
        if (provider.catalog.provider === "bandcamp") await until(async () => await execute("return document.querySelector('[data-player-art] img')?.naturalWidth > 0"));
        else {
          await ui.button("Settings", "[data-player-tools]");
          await until(async () => await execute("return [...document.querySelectorAll('[data-player-sheet] button')].some(button => button.textContent.trim() === '720p' && button.getAttribute('aria-pressed') === 'true')"));
          await ui.key(keys.escape);
        }
        if (provider.live) await until(() => remotes.every(remote => remote.state?.queue.some(item => item.id === entry!.id && item.live === true)));
      }
      phase = "capture the actual native window";
      await ui.watching();
      await execute("window.scrollTo(0, 0)");
      if (provider.catalog?.provider === "bandcamp") await captureBandcampAudio(ui, entry!.title, name, artifacts, screenshot);
      else await screenshot(name);
      result = { ...provider, status: "passed", seconds: (performance.now() - started) / 1000, entry: remotes[0]!.state!.queue.find(item => item.id === entry!.id), tracks: remotes[0]!.state!.player.tracks?.map(track => ({ kind: track.kind, selected: track.selected })), observations: `${provider.catalog ? `Find result or pasted public link, ${provider.catalog.provider === "bandcamp" ? "audio-only controls" : "quality selection"}, shared queue${provider.catalog.provider === "bandcamp" ? "" : " and favorite"}. ` : ""}Native audio/video metadata and advancing position reached two paired remotes; second remote changed volume; actual X11 screenshot captured.` };
      console.log(`PASS native provider ${provider.name}`);
    } catch (error) {
      await screenshot(`${name}-failed`).catch(() => {});
      const diagnostics = await execute("return { alerts: [...document.querySelectorAll('[role=alert]')].map(item => item.textContent), titles: [...document.querySelectorAll('[data-hit-id] [data-play] span:first-child')].map(item => item.textContent), input: document.querySelector('#media-search')?.outerHTML, body: getComputedStyle(document.body).pointerEvents, menus: [...document.querySelectorAll('[role=listbox]')].map(item => item.outerHTML), filters: [...document.querySelectorAll('[aria-label=\"From filter\"] button')].map(item => [item.textContent,item.getAttribute('aria-pressed')]) }").catch(() => null);
      result = { ...provider, status: "failed", phase, error: String(error), diagnostics };
      console.log(`FAIL native provider ${provider.name} during ${phase}: ${String(error)}`);
    } finally {
      command(0, { type: "stop" });
      await until(() => remotes.every(remote => remote.state!.player.status === "idle"));
      await record(result!);
    }
  }
  if (catalogs) {
    httpRemote = await verifyBandcamp({ ui, origin, artifacts, code, remotes, command, until, screenshot, record,
      reconnect: index => { remotes[index]!.socket.close(); connect(remotes[index]!); } });
  }
  if (catalogs && (favorites.size || httpRemote)) {
    const queue = remotes[0]!.state!.queue;
    remotes.forEach(remote => remote.socket.close());
    await wd(`/session/${session}`, undefined, "DELETE");
    session = "";
    await until(async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } });
    session = (await wd("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
    await until(async () => await execute("return document.querySelector('[role=status]')?.textContent") === "Connected");
    await ui.button("Settings"); await ui.settingsSection("general");
    await until(async () => await execute("return !!document.querySelector('[data-administrator-code]')"));
    await ui.key(keys.escape);
    await until(async () => !await execute("return !!document.querySelector('[role=dialog]')"));
    remotes.forEach(connect);
    await until(() => remotes.every(remote => remote.state?.player.status === "idle" && JSON.stringify(remote.state.queue) === JSON.stringify(queue)));
    for (let index = 0; index < 2; index++) {
      const saved = (await api("/api/providers/favorites", index)).favorites as ProviderItem[];
      assert.ok([...favorites.keys()].every(id => saved.some(item => item.id === id)), "Public provider favorites survive restart for both paired remotes");
      const later = (await api("/api/for-later", index)).items as { title: string }[];
      assert.ok([...savedMedia.keys()].every(title => later.some(item => item.title === title)), "Saved public media survives restart for both paired remotes");
    }
    await ui.section("Saved");
    await ui.click('[aria-label="Saved sections"] [role="tab"]:nth-child(2)');
    for (const item of favorites.values()) await until(async () => await execute("return [...document.querySelectorAll('[aria-label=\"Saved online items and stations\"] strong')].some(title => title.textContent === arguments[0])", [item.title]));
    await ui.click('[aria-label="Saved sections"] [role="tab"]:first-child');
    for (const title of savedMedia.keys()) await until(async () => await execute("return [...document.querySelectorAll('[aria-label=\"For later\"] [data-play] > span:first-child')].some(element => element.textContent === arguments[0])", [title]));
    await screenshot("catalog-favorites-after-restart");
    if (httpRemote) await verifyBandcampRestart(httpRemote, queue, until);
    await Bun.write(`${artifacts}/catalog-persistence.json`, JSON.stringify({ ...provenance, status: "passed", queue, favorites: [...favorites.values()], observations: "Queue metadata and quality, ordered Bandcamp albums, paired remote credentials and all saved provider cards survived desktop restart without autoplay. The HTTP phone reconnected with the same complete queue." }, null, 2));
    console.log("PASS native provider favorites, metadata and quality survive desktop restart for both remotes");
  }
  assert.equal(results.some(result => (result as { status: string }).status === "failed"), false, "All requested public providers play through the native app");
} finally {
  await httpRemote?.close();
  remotes.forEach(remote => remote.socket.close());
  if (session) await wd(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill();
}
