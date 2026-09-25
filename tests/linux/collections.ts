import { seedConfiguredFixture } from "./configured-fixture";
seedConfiguredFixture();
import { remoteSocketUrl } from "./build";
import { strict as assert } from "node:assert";
import { mkdir, rename } from "node:fs/promises";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import type { CollectionPreview, SavedCollection } from "../../src/shared/collections";
import { UiDriver, startHttpRemote, keys, assertResponsive } from "./ui";
import { addTVFolder, openFolderSources, closeFolderSources, folderCard } from "./folder-settings";
import { assertNativeUiPixels, assertNativeVideoPixels } from "./pixels";
const origin = "http://127.0.0.1:4100", artifactDir = "/artifacts", driverOrigin = "http://127.0.0.1:4444";
const checks: string[] = [];
const clients: Remote[] = [];
const remotes: Awaited<ReturnType<typeof startHttpRemote>>[] = [];
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
let sessionId = "";
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifactDir}/driver.log`), stderr: Bun.file(`${artifactDir}/native.log`) });
async function until(description: string, predicate: () => boolean | Promise<boolean>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error(`${description} timed out`); await Bun.sleep(50); }
  checks.push(description); console.log(`PASS ${description}`);
}
async function webdriver(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`${driverOrigin}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as { value: any };
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result));
  return result.value;
}
const ui = new UiDriver(webdriver, () => sessionId);
async function persistNavigation(phase: string, final?: unknown) {
  const events = await ui.execute("return window.collectionNavigationTrace ?? null");
  if (events) await Bun.write(`${artifactDir}/navigation-trace.json`, JSON.stringify({ phase, final, events }, null, 2));
}
async function launch() {
  sessionId = (await webdriver("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until("native app connects", () => ui.execute("return document.querySelector('[role=status]')?.textContent === 'Connected'"), 30_000);
  await until("unclaimed administrator Settings opens after launch", () => ui.execute("return document.querySelector('[role=dialog] h2')?.textContent === 'Settings'"));
  await ui.button("Close", '[role="dialog"]');
  await until("startup Settings dialog and overlay close", () => ui.execute("return !document.querySelector('[role=dialog][data-state=open], [data-slot=dialog-overlay][data-state=open]')"));
}
async function api(path: string, body?: unknown, index = 0, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${origin}${path}`, { method, headers: { Origin: origin, Authorization: `Bearer ${clients[index]!.token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  return { status: response.status, data: await response.json() };
}
const all = (predicate: (state: SessionState) => boolean) => clients.length === 2 && clients.every(client => client.state && predicate(client.state));
const list = async () => (await api("/api/collections")).data.collections as SavedCollection[];
const detail = async (id: string) => (await api(`/api/collections/${id}`)).data as CollectionPreview;
const panel = ".collections-panel";
async function open(target: UiDriver) { await target.section("Library"); await target.button("Collections", '[aria-label="Library view"]'); }
async function selected(target: UiDriver, name: string) { await until(`collection ${name} is open`, () => target.execute("return document.querySelector('.collections-panel h3')?.textContent === arguments[0] && !document.querySelector('.collections-panel')?.textContent.includes('Refreshing preview')", [name])); }
async function stop() { await clients[0]!.command({ type: "stop" }); await until("Stop reaches both controllers", () => all(state => state.player.status === "idle")); }
async function capture(name: string) {
  await ui.execute("document.querySelectorAll('[data-pairing-code], .pair-shortcut strong, [data-administrator-code]').forEach(element => element.style.visibility = 'hidden')");
  const child = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", `${artifactDir}/${name}.png`], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await child.exited, 0);
}
async function fixtures() {
  await mkdir("/mnt/collections-fixtures", { recursive: true });
  const run = async (args: string[]) => { const child = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "inherit", stderr: "inherit" }); assert.equal(await child.exited, 0); };
  await run(["-f", "lavfi", "-i", "color=c=red:s=640x360:r=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "45", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-c:a", "aac", "/mnt/collections-fixtures/Red.mkv"]);
  await Bun.write("/mnt/collections-fixtures/Blue.mkv", Bun.file("/mnt/collections-fixtures/Red.mkv"));
  for (const [title, year] of [["Red", 2020], ["Blue", 2021]]) await Bun.write(`/mnt/collections-fixtures/${title}.nfo`, `<movie><title>${title}</title><year>${year}</year><genre>Generated</genre></movie>`);
  for (const [title, track] of [["Song two", 2], ["Song one", 1]]) await run(["-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "30", "-c:a", "flac", "-metadata", `title=${title}`, "-metadata", "artist=Generated artist", "-metadata", "album=Generated album", "-metadata", `track=${track}`, `/mnt/collections-fixtures/${title}.flac`]);
  await run(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000", "-t", "0.1", "-c:a", "flac", "-metadata", "title=Traversal track", "-metadata", "artist=Traversal", "/mnt/traversal.flac"]);
  for (let index = 0; index < 40; index++) await Bun.write(`/mnt/collections-fixtures/Traversal-${index}.flac`, Bun.file("/mnt/traversal.flac"));

}
class Remote {
  state: SessionState | null = null;
  socket!: WebSocket;
  pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

  constructor(readonly token: string) { this.connect(); }

  async connect() {
    this.state = null;
    this.socket = new BunWebSocket(await remoteSocketUrl(origin, this.token), { headers: { origin } });
    this.socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "state") this.state = message.state;
      else if (message.type === "navigation") assert.fail("TV navigation must reach only the native host, never another controller");
      else {
        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        if (message.ok) pending?.resolve();
        else pending?.reject(new Error(message.error || "Command rejected"));
      }
    };
    this.socket.onclose = () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Remote disconnected"));
      this.pending.clear();
    };
  }

  command(action: Action) {
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`${action.type} acknowledgement timed out`)); }, 5_000);
      this.pending.set(requestId, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ type: "command", requestId, action }));
    });
  }
}

try {
  await fixtures();
  await until("official Tauri driver ready", async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  await launch();
  await ui.click(".pair-shortcut");
  const code = await ui.execute("return document.querySelector('[data-pairing-code]')?.textContent") as string;
  await ui.key(keys.escape);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${origin}/api/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    assert.equal(response.status, 200); clients.push(new Remote((await response.json()).token));
  }
  await until("two controllers receive initial snapshots", () => all(state => state.player.status === "idle"));
  const sourceId = await addTVFolder(ui, until, "collections-fixtures");
  await until("real scanner indexes two films, two album tracks and forty traversal tracks", async () => (await api("/api/library/items")).data.total === 44);
  await open(ui);
  await ui.button("New collection", panel);
  await ui.type("#collection-name", "Film night");
  await until("manual movie picker finishes reading", () => ui.execute("return document.querySelectorAll('[aria-label=\"Movies to add\"] button').length === 2"));
  await ui.button("Red", '[aria-label="Movies to add"]');
  await ui.button("Blue", '[aria-label="Movies to add"]');
  await ui.button("Save collection", panel);
  await selected(ui, "Film night");
  const manual = (await list()).find(item => item.name === "Film night")!;
  assert.deepEqual((await detail(manual.id)).items.map(item => item.title), ["Red", "Blue"]);
  await capture("native-collection-preview");
  await ui.button("Play preview", panel);
  await until("native collection play commits visible order to both controllers", () => all(state => state.player.status === "playing" && state.queue.map(item => item.title).join(",") === "Red,Blue" && state.currentEntryId === state.queue[0]?.id));
  await ui.controls();
  await until("native player opens before video pixel sampling", () => ui.execute("return !!document.querySelector('.player-page .video-stage')"));
  await assertNativeVideoPixels(ui.execute, artifactDir, "native-collection-playing", [253, 0, 0]);
  await assertNativeUiPixels(ui.execute, artifactDir);
  await stop();
  remotes.push(await startHttpRemote(origin, code, artifactDir, until, 4446, 1.5));
  const phone = remotes[0]!;
  const typePhone = async (selector: string, value: string) => {
    await phone.ui.click(selector);
    const actions = [{ type: "keyDown", value: "\uE009" }, { type: "keyDown", value: "a" }, { type: "keyUp", value: "a" }, { type: "keyUp", value: "\uE009" }, { type: "keyDown", value: "\uE003" }, { type: "keyUp", value: "\uE003" }, ...Array.from(value).flatMap(character => [{ type: "keyDown", value: character }, { type: "keyUp", value: character }])];
    await phone.ui.request(`/session/${phone.ui.session()}/actions`, { actions: [{ type: "key", id: "collection-editor", actions }] });
    await until(`phone keyboard fills ${selector}`, () => phone.ui.execute("return document.activeElement === document.querySelector(arguments[0]) && document.querySelector(arguments[0]).value === arguments[1]", [selector, value]));
  };
  await open(phone.ui);
  await phone.ui.button("New collection", panel);
  await typePhone("#collection-name", "Album filter");
  await phone.ui.select('[aria-label="Collection type"]', "Music filter");
  await phone.ui.select('[aria-label="Sort order"]', "Album, disc and track");
  await typePhone("#collection-artist", "Generated artist");
  await typePhone("#collection-album", "Generated album");
  await assertResponsive(phone.ui, "Music collection editor");
  await phone.screenshot("phone-collection-editor");
  await phone.ui.button("Save collection", panel);
  await selected(phone.ui, "Album filter");
  const music = (await list()).find(item => item.name === "Album filter")!;
  assert.deepEqual((await detail(music.id)).items.map(item => item.title), ["Song one", "Song two"]);
  await until("shared creation preserves TV's independently selected film collection", () => ui.execute("return document.querySelector('.collections-panel h3')?.textContent === 'Film night'"));
  await phone.ui.button("Add preview to queue", panel);
  await until("phone append keeps idle playback and follows preview track order", () => all(state => state.player.status === "idle" && state.queue.map(item => item.title).join(",") === "Red,Blue,Song one,Song two"));
  await phone.ui.button("Play preview", panel);
  await until("phone play replaces queue and starts native audio", () => all(state => state.player.status === "playing" && state.queue.map(item => item.title).join(",") === "Song one,Song two" && state.player.position > 0.5));
  await stop();
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rect = await phone.ui.request(`/session/${phone.ui.session()}/window/rect`);
      const actual = await phone.ui.execute("return innerWidth");
      if (actual === width) break;
      await phone.ui.request(`/session/${phone.ui.session()}/window/rect`, { width: Math.round(rect.width * width / actual), height: 950 });
    }
    await until(`collection viewport settles at ${width}`, () => phone.ui.execute("return innerWidth === arguments[0]", [width]));
    const layout = await phone.ui.execute("return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, clipped: [...document.querySelectorAll('.collections-panel button')].filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2).map(el => el.textContent) }");
    assert.equal(layout.overflow, false); assert.deepEqual(layout.clipped, []);
    await phone.screenshot(`collection-${width}`);
  }
  await phone.minimize();
  const traversal = (await api("/api/collections", { definition: { name: "Long preview", sort: "title", descending: false, filter: { kind: "audio", artist: "Traversal" }, members: [] } })).data as CollectionPreview;
  assert.equal(traversal.items.length, 40);
  await open(ui); await ui.button("All collections", panel);
  await ui.execute(`
    window.collectionNavigationTrace = [];
    const nodes = new WeakMap(); let nextNode = 0;
    const identify = element => {
      if (!(element instanceof HTMLElement)) return null;
      if (!nodes.has(element)) nodes.set(element, ++nextNode);
      return { node: nodes.get(element), tag: element.tagName, id: element.id, label: element.getAttribute('aria-label'), connected: element.isConnected, rect: element.getBoundingClientRect().toJSON() };
    };
    const record = (event, phase) => {
      const list = document.querySelector('[aria-label="Collection preview"]');
      window.collectionNavigationTrace.push({ phase, type: event.type, key: event.key, prevented: event.defaultPrevented, time: performance.now(), focused: document.hasFocus(), visibility: document.visibilityState, target: identify(event.target), active: identify(document.activeElement), list: list && { scroll: list.scrollTop, rect: list.getBoundingClientRect().toJSON(), rows: [...list.children].map(identify) } });
      if (window.collectionNavigationTrace.length > 100) window.collectionNavigationTrace.shift();
    };
    for (const type of ['keydown', 'keyup', 'focusin', 'focusout', 'focus', 'blur']) window.addEventListener(type, event => record(event, 'capture'), true);
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => record(event, 'bubble'));
  `);
  await ui.button("Long previewSaved filter", panel); await selected(ui, "Long preview");
  await ui.execute("const list = document.querySelector('[aria-label=\"Collection preview\"]'); list.scrollTop = 0; list.querySelector('li').focus();");
  for (let index = 1; index <= 12; index++) {
    await ui.key(keys.down);
    await until(`physical Down traverses preview row ${index + 1}`, () => ui.execute("return document.activeElement === document.querySelectorAll('[aria-label=\"Collection preview\"] li')[arguments[0]]", [index]));
  }
  const physicalScroll = await ui.execute("return document.querySelector('[aria-label=\"Collection preview\"]').scrollTop");
  assert.ok(physicalScroll > 0);
  for (let index = 13; index <= 24; index++) {
    await clients[1]!.command({ type: "navigate", key: "down" });
    await until(`paired Down traverses preview row ${index + 1}`, () => ui.execute("return document.activeElement === document.querySelectorAll('[aria-label=\"Collection preview\"] li')[arguments[0]]", [index]));
  }
  const finalNavigation = await ui.execute("const list=document.querySelector('[aria-label=\"Collection preview\"]'), row=list.children[24], bounds=list.getBoundingClientRect(), rect=row.getBoundingClientRect(); return { focused: document.activeElement === row, scroll: list.scrollTop, previousScroll: arguments[0], visible: rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, row: rect.toJSON(), list: bounds.toJSON() }", [physicalScroll]);
  await persistNavigation("traversal complete", finalNavigation);
  assert.equal(finalNavigation.focused && finalNavigation.scroll > physicalScroll && finalNavigation.visible, true, "Paired navigation scrolls farther and reveals its final preview row");
  await capture("native-long-collection-navigation");
  await ui.button("All collections", panel); await ui.button("Film night2 movies", panel); await selected(ui, "Film night");
  await ui.button("Edit collection", panel);
  await ui.type("#collection-name", "TV draft");
  const beforeEdit = await detail(manual.id);
  const { id: _id, revision, updatedAt: _updatedAt, ...definition } = beforeEdit.collection;
  assert.equal((await api(`/api/collections/${manual.id}`, { revision, definition: { ...definition, name: "Renamed by phone" } }, 1)).status, 200);
  await until("native edit keeps its unsaved value and warns about newer committed data", () => ui.execute("return document.querySelector('#collection-name')?.value === 'TV draft' && document.querySelector('.collections-panel')?.textContent.includes('Your draft is still here')"));
  await ui.button("Save collection", panel);
  await until("native stale save is rejected without replacing the phone edit", () => ui.execute("return document.querySelector('.collections-panel [role=alert]')?.textContent.includes('changed on another controller')"));
  assert.equal((await detail(manual.id)).collection.name, "Renamed by phone");
  await ui.button("Cancel editing", panel);
  await selected(ui, "Renamed by phone");
  const oldPreview = await detail(manual.id);
  await rename("/mnt/collections-fixtures/Red.mkv", "/mnt/Red-away.mkv");
  await rename("/mnt/collections-fixtures/Song one.flac", "/mnt/Song-one-away.flac");
  await openFolderSources(ui, until); await ui.button("Scan again", folderCard(sourceId)); await closeFolderSources(ui, until);
  await until("rescan marks removed film and matching music unavailable", async () => !(await detail(manual.id)).items[0]!.available && !(await detail(music.id)).items[0]!.available);
  assert.equal((await api(`/api/collections/${manual.id}/load`, { revision: oldPreview.collection.revision, digest: oldPreview.digest, mode: "play" })).status, 409);
  await open(ui); await selected(ui, "Renamed by phone");
  await ui.button("Add preview to queue", panel);
  await until("missing film is skipped and available film is appended", () => all(state => state.queue.at(-1)?.title === "Blue" && state.player.status === "idle"));
  clients[1]!.socket.close(); clients[1]!.connect();
  await until("second controller reconnect receives current committed queue", () => all(state => state.queue.at(-1)?.title === "Blue"));
  await rename("/mnt/collections-fixtures", "/mnt/collections-offline");
  await openFolderSources(ui, until); await ui.button("Scan again", folderCard(sourceId)); await closeFolderSources(ui, until);
  await until("whole source reports unavailable", async () => (await api("/api/library/sources")).data.sources[0].status === "unavailable");
  const queueBefore = clients[0]!.state!.queue;
  await webdriver(`/session/${sessionId}`, undefined, "DELETE"); sessionId = "";
  await launch(); clients.forEach(client => client.connect());
  await until("whole app restarts offline with durable queue and no autoplay", () => all(state => state.player.status === "idle" && JSON.stringify(state.queue.map(item => item.id)) === JSON.stringify(queueBefore.map(item => item.id))));
  assert.deepEqual((await detail(manual.id)).items.map(item => [item.title, item.available]), [["Red", false], ["Blue", false]]);
  assert.deepEqual((await detail(music.id)).items.map(item => [item.title, item.available]), [["Song one", false], ["Song two", false]]);
  await open(ui); await ui.button("Renamed by phone2 movies", panel); await selected(ui, "Renamed by phone");
  await until("offline preview disables both native loading controls", () => ui.execute("const buttons=[...document.querySelectorAll('.collections-panel button')].filter(button => ['Play preview', 'Add preview to queue'].includes(button.textContent.trim())); return buttons.length === 2 && buttons.every(button => button.disabled)"));
  await capture("native-collection-offline-restart");
  const latest = await detail(manual.id);
  assert.equal((await api(`/api/collections/${manual.id}`, { revision: latest.collection.revision }, 0, "DELETE")).status, 200);
  assert.equal((await api(`/api/collections/${manual.id}`)).status, 404);
  await Bun.write(`${artifactDir}/collections-results.json`, JSON.stringify({ status: "passed", checks, source: process.env.COUCH_QUALIFICATION_HEAD, manual: manual.id, music: music.id, previewWidths: [320, 375, 390, 768, 1024, 1440, 1920], editorWidths: [390], note: "Ubuntu software rendering and a null audio sink qualify software behavior only." }, null, 2));
} catch (error) {
  await Bun.write(`${artifactDir}/collections-results.json`, JSON.stringify({ status: "failed", checks, error: String(error) }, null, 2));
  if (sessionId) await persistNavigation("failure").catch(() => {});
  for (const [index, remote] of remotes.entries()) {
    await Bun.write(`${artifactDir}/phone-${index}-failure-dom.txt`, String(await remote.ui.execute("return document.body.innerText").catch(() => "")));
    await remote.screenshot(`phone-${index}-failure`).catch(() => {});
  }
  if (sessionId) { await Bun.write(`${artifactDir}/failure-dom.txt`, String(await ui.execute("return document.body.innerText").catch(() => ""))); await capture("native-collections-failure").catch(() => {}); }
  throw error;
} finally {
  for (const client of clients) client.socket.close();
  for (const remote of remotes) await remote.close();
  if (sessionId) await webdriver(`/session/${sessionId}`, undefined, "DELETE").catch(() => {});
  driver.kill(); await driver.exited;
}
