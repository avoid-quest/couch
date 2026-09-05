import { strict as assert } from "node:assert";
import type { Action, QueueEntry, ServerMessage, SessionState } from "../../src/shared/protocol";
import type { ProviderId, ProviderItem } from "../../src/shared/providers";
import { UiDriver, keys, qualityLabel } from "./ui";

type Provider = { name: string; url?: string; kind: "webpage" | "direct"; video: boolean; live?: boolean; observeSeconds?: number; seekPosition?: number; catalog?: { provider: ProviderId; search?: string; open?: string[]; match: string } };
const catalogs = process.env.COUCH_TEST_PROVIDER_CATALOGS === "1";
const providers: Provider[] = catalogs ? [
  { name: "YouTube search Big Buck Bunny", kind: "webpage", video: true, seekPosition: 30, catalog: { provider: "youtube", search: "Big Buck Bunny Blender Foundation", match: "^Big Buck Bunny$" } },
  { name: "Twitch search LofiGirl live", kind: "webpage", video: true, live: true, observeSeconds: 35, catalog: { provider: "twitch", search: "LofiGirl", match: "LofiGirl" } },
  { name: "RaiPlay browse live Rai News 24", kind: "webpage", video: true, live: true, catalog: { provider: "raiplay", open: ["^Dirette TV$"], match: "^Rai News ?24$" } },
  { name: "RaiPlay browse news program episode", kind: "webpage", video: true, catalog: { provider: "raiplay", open: ["^L'informazione Rai$", "^RaiNews$", "^Rai News - Puntate$"], match: "^RaiNews24$" } },
  { name: "RaiPlay search RaiNews24 replay", kind: "webpage", video: true, catalog: { provider: "raiplay", search: "RaiNews24", match: "RaiNews24" } },
  { name: "RaiPlay browse recent replay", kind: "webpage", video: true, catalog: { provider: "raiplay", open: ["^Replay - ultimi 7 giorni$", "^\\d{2}/\\d{2}/\\d{4}$", "^Rai News ?24$"], match: "RASSEGNA STAMPA|RaiNews24" } },
] : await Bun.file(process.env.COUCH_TEST_PROVIDERS!).json() as Provider[];
const artifacts = "/artifacts/providers";
await Bun.$`mkdir -p ${artifacts}`.quiet();
for (const name of ["versions.txt", "sources.sha256", "binaries.sha256"]) await Bun.write(`${artifacts}/${name}`, Bun.file(`/artifacts/${name}`));
const origin = "http://127.0.0.1:4100";
const driverOrigin = "http://127.0.0.1:4444";
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/driver.log`), stderr: Bun.file(`${artifacts}/native.log`) });
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
let session = "";
const remotes: { token: string; socket: WebSocket; state: SessionState | null }[] = [];
const favorites = new Map<string, ProviderItem>();
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
async function interact(selector: string, value?: string) {
  if (value === undefined) await ui.click(selector);
  else await ui.type(selector, value);
}
async function button(scope: string, label: string) {
  await ui.button(label, scope);
}
async function card(pattern: string, collection = false) {
  let index = -1;
  await until(async () => {
    const error = await execute("return document.querySelector('.provider-error')?.textContent");
    if (error) throw new Error(error);
    index = await execute(`return [...document.querySelectorAll('.provider-item')].findIndex(card => new RegExp(arguments[0], 'i').test(card.querySelector('h4').textContent) && !!card.querySelector('.provider-open') === arguments[1])`, [pattern, collection]);
    return index >= 0;
  }, 45_000);
  await execute("document.querySelector(arguments[0]).scrollIntoView({ block: 'center' })", [`.provider-item:nth-child(${index + 1})`]);
  return `.provider-item:nth-child(${index + 1})`;
}
async function api(path: string, index = 0) {
  const response = await fetch(`${origin}${path}`, { headers: { origin, Authorization: `Bearer ${remotes[index]!.token}` }, signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  return response.json() as Promise<any>;
}
function connect(remote: typeof remotes[number]) {
  remote.state = null;
  remote.socket = new BunWebSocket(`${origin.replace("http", "ws")}/api/ws?token=${remote.token}`, { headers: { origin } });
  remote.socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") remote.state = message.state;
  };
}
function command(index: number, action: Action) {
  remotes[index]!.socket.send(JSON.stringify({ type: "command", requestId: crypto.randomUUID(), action }));
}
async function screenshot(name: string) {
  await execute("document.querySelectorAll('.pairing-display, .pair-shortcut strong').forEach(pairing => pairing.style.visibility='hidden')");
  await Bun.sleep(250);
  const capture = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", `${artifacts}/${name}.png`], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await capture.exited, 0);
}

try {
  await until(async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  session = (await wd("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until(async () => await execute("return document.querySelector('[role=status]')?.textContent") === "Connected");
  await ui.click(".pair-shortcut");
  const code = await execute("return document.querySelector('.pairing-display strong').textContent");
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
  for (const [index, provider] of providers.entries()) {
    const name = `${index + 1}-${provider.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const started = performance.now();
    console.log(`START native provider ${provider.name}`);
    let phase = "add media through the native UI";
    let entry: QueueEntry | undefined;
    try {
      if (provider.catalog) {
        phase = "browse the provider through the native Online UI";
        await ui.section("Online");
        phase = "select provider";
        await button(".provider-selector", { youtube: "YouTube", twitch: "Twitch", raiplay: "RaiPlay" }[provider.catalog.provider]);
        phase = "open provider home";
        await button(".provider-toolbar", "Home");
        phase = "select provider quality";
        await ui.select("#provider-quality", qualityLabel("720p"));
        await until(async () => await execute("return !document.querySelector('[role=listbox]') && document.querySelector('#provider-quality').textContent.trim() === 'Up to 720p'"));
        if (provider.catalog.search) {
          phase = "type provider search";
          await interact("#provider-search", provider.catalog.search);
          phase = "submit provider search";
          await interact(".provider-search button");
        }
        for (const title of provider.catalog.open ?? []) await interact(`${await card(title, true)} .provider-open`);
        const selected = await card(provider.catalog.match);
        if (provider.live) assert.ok(await execute("return !!document.querySelector(arguments[0] + ' .provider-badge.live')", [selected]), "Live provider card is marked LIVE");
        const title = await execute("return document.querySelector(arguments[0] + ' h4').textContent", [selected]);
        const thumbnail = await execute("return document.querySelector(arguments[0] + ' img')?.src", [selected]);
        assert.ok(thumbnail, "Public provider card includes artwork");
        await until(async () => await execute("return document.querySelector(arguments[0] + ' img')?.naturalWidth > 0", [selected]));
        const before = remotes[0]!.state!.providerVersion ?? 0;
        const saved = await execute("return document.querySelector(arguments[0] + ' .provider-save').getAttribute('aria-pressed') === 'true'", [selected]);
        if (!saved) {
          await interact(`${selected} .provider-save`);
          await until(() => remotes.every(remote => (remote.state?.providerVersion ?? 0) > before));
        }
        const favorite = (await api("/api/providers/favorites", 1)).favorites.find((item: ProviderItem) => item.provider === provider.catalog!.provider && item.title === title) as ProviderItem | undefined;
        assert.ok(favorite, "Native saved card reaches the second remote");
        favorites.set(favorite.id, favorite);
        const queued = new Set(remotes[0]!.state!.queue.map(item => item.id));
        phase = "play selected provider card on TV";
        await button(selected, "Play on TV");
        await until(() => remotes.every(remote => remote.state?.queue.some(item => !queued.has(item.id) && item.title === title && item.thumbnail === thumbnail && item.quality === "720p")));
        entry = remotes[0]!.state!.queue.find(item => !queued.has(item.id))!;
        provider.url = entry.source.slice(4);
      } else {
        await ui.select("#media-kind", provider.kind === "webpage" ? "Webpage" : "Direct media");
        await interact("#media-url", provider.url!);
        await interact("#media-title", provider.name);
        await interact(".queue-add-form button[type=submit]");
        await until(() => remotes.every(remote => remote.state?.queue.some(entry => entry.title === provider.name)));
        entry = remotes[0]!.state!.queue.find(entry => entry.title === provider.name)!;
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
        phase = "show online artwork and quality in the native shared queue";
        await ui.section("Queue");
        await until(async () => await execute(`
          const row = [...document.querySelectorAll('.queue-entry')].reverse().find(row => row.querySelector('.queue-entry-title')?.textContent === arguments[0]);
          row?.scrollIntoView({ block: 'center' });
          return row?.querySelector('img')?.naturalWidth > 0 && row.textContent.includes('720p');
        `, [entry!.title]));
        if (provider.live) await until(() => remotes.every(remote => remote.state?.queue.some(item => item.id === entry!.id && item.live === true)));
      }
      phase = "capture the actual native window";
      await ui.watching();
      await execute("window.scrollTo(0, 0)");
      await screenshot(name);
      results.push({ ...provider, status: "passed", seconds: (performance.now() - started) / 1000, entry: remotes[0]!.state!.queue.find(item => item.id === entry!.id), tracks: remotes[0]!.state!.player.tracks?.map(track => ({ kind: track.kind, selected: track.selected })), observations: `${provider.catalog ? "Native Online browsing, card artwork, quality selection, Play on TV and shared favorite checked. " : ""}Native audio/video metadata and advancing position reached two paired remotes; second remote changed volume; actual X11 screenshot captured.` });
      console.log(`PASS native provider ${provider.name}`);
    } catch (error) {
      await screenshot(`${name}-failed`).catch(() => {});
      const diagnostics = await execute("return { alerts: [...document.querySelectorAll('[role=alert]')].map(item => item.textContent), titles: [...document.querySelectorAll('.provider-item h4')].map(item => item.textContent), quality: document.querySelector('#provider-quality')?.outerHTML, input: document.querySelector('#provider-search')?.outerHTML, hidden: document.querySelector('#provider-search')?.closest('[hidden]')?.outerHTML.slice(0,500), body: getComputedStyle(document.body).pointerEvents, menus: [...document.querySelectorAll('[role=listbox]')].map(item => item.outerHTML), tabs: [...document.querySelectorAll('.source-nav button')].map(item => [item.textContent,item.getAttribute('data-state')]) }").catch(() => null);
      results.push({ ...provider, status: "failed", phase, error: String(error), diagnostics });
      console.log(`FAIL native provider ${provider.name} during ${phase}: ${String(error)}`);
    } finally {
      command(0, { type: "stop" });
      await until(() => remotes.every(remote => remote.state!.player.status === "idle"));
      const latest = results.at(-1) as Record<string, unknown>;
      const oldIndex = previous.findIndex(result => catalogs ? result.name === latest.name && !!result.catalog : result.url === latest.url && result.kind === latest.kind && !result.catalog);
      if (oldIndex !== -1) previous.splice(oldIndex, 1);
      previous.push({ ...latest, ...provenance });
      await Bun.write(`${artifacts}/native-results.json`, JSON.stringify(previous, null, 2));
      await Bun.write(`${artifacts}/native-run-results.json`, JSON.stringify({ ...provenance, cases: results }, null, 2));
    }
  }
  if (catalogs && favorites.size) {
    const queue = remotes[0]!.state!.queue;
    remotes.forEach(remote => remote.socket.close());
    await wd(`/session/${session}`, undefined, "DELETE");
    session = "";
    await until(async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } });
    session = (await wd("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
    await until(async () => await execute("return document.querySelector('[role=status]')?.textContent") === "Connected");
    remotes.forEach(connect);
    await until(() => remotes.every(remote => remote.state?.player.status === "idle" && JSON.stringify(remote.state.queue) === JSON.stringify(queue)));
    for (let index = 0; index < 2; index++) {
      const saved = (await api("/api/providers/favorites", index)).favorites as ProviderItem[];
      assert.ok([...favorites.keys()].every(id => saved.some(item => item.id === id)), "Public provider favorites survive restart for both paired remotes");
    }
    await ui.section("Online");
    for (const provider of new Set([...favorites.values()].map(item => item.provider))) {
      await button(".provider-selector", { youtube: "YouTube", twitch: "Twitch", raiplay: "RaiPlay" }[provider]);
      await interact('.provider-views [role="tab"]:nth-child(2)');
      for (const item of favorites.values()) if (item.provider === provider) await until(async () => await execute("return [...document.querySelectorAll('.provider-item h4')].some(title => title.textContent === arguments[0])", [item.title]));
    }
    await screenshot("catalog-favorites-after-restart");
    await Bun.write(`${artifacts}/catalog-persistence.json`, JSON.stringify({ ...provenance, status: "passed", queue, favorites: [...favorites.values()], observations: "Queue metadata and quality, paired remote credentials and all saved provider cards survived desktop restart without autoplay." }, null, 2));
    console.log("PASS native provider favorites, metadata and quality survive desktop restart for both remotes");
  }
  assert.equal(results.some(result => (result as { status: string }).status === "failed"), false, "All requested public providers play through the native app");
} finally {
  remotes.forEach(remote => remote.socket.close());
  if (session) await wd(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill();
}
