import { strict as assert } from "node:assert";
import { mkdir, readFile, rename } from "node:fs/promises";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import type { MetadataView } from "../../src/shared/metadata";
import { UiDriver, startHttpRemote, keys, assertResponsive } from "./ui";
import { addTVFolder } from "./folder-settings";
import { assertNativeUiPixels, assertNativeVideoPixels } from "./pixels";

const origin = "http://127.0.0.1:4100", artifacts = "/artifacts", driverOrigin = "http://127.0.0.1:4444";
const checks: string[] = [], clients: Remote[] = [];
let sessionId = "", administrator = "", phone: Awaited<ReturnType<typeof startHttpRemote>> | null = null;
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/driver.log`), stderr: Bun.file(`${artifacts}/native.log`) });
async function until(description: string, predicate: () => boolean | Promise<boolean>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error(`${description} timed out`); await Bun.sleep(50); }
  checks.push(description); console.log(`PASS ${description}`);
}
async function webdriver(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`${driverOrigin}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as { value: any };
  if (!response.ok || result.value?.error) throw new Error(result.value?.message || result.value?.error || `WebDriver ${response.status}`);
  return result.value;
}
const ui = new UiDriver(webdriver, () => sessionId);
const all = (predicate: (state: SessionState) => boolean) => clients.length === 2 && clients.every(client => client.state && predicate(client.state));
async function api(path: string, body?: unknown, token = administrator) {
  return fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
}
async function data(path: string, body?: unknown) { const response = await api(path, body); assert.equal(response.status, 200); return response.json(); }
async function launch() {
  sessionId = (await webdriver("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until("native Couch connects", () => ui.execute("return document.querySelector('[role=status]')?.textContent === 'Connected'"), 30_000);
}
async function keyboard(target: UiDriver, selector: string, value: string) {
  await target.click(selector);
  const actions = [{ type: "keyDown", value: "\uE009" }, { type: "keyDown", value: "a" }, { type: "keyUp", value: "a" }, { type: "keyUp", value: "\uE009" }, { type: "keyDown", value: "\uE003" }, { type: "keyUp", value: "\uE003" }, ...Array.from(value).flatMap(character => [{ type: "keyDown", value: character }, { type: "keyUp", value: character }])];
  await target.request(`/session/${target.session()}/actions`, { actions: [{ type: "key", id: "metadata-editor", actions }] });
  await until(`real keyboard fills ${selector}`, () => target.execute("return document.activeElement === document.querySelector(arguments[0]) && document.querySelector(arguments[0]).value === arguments[1]", [selector, value]));
}
async function movieEditor(target: UiDriver, title: string) {
  await target.section("Library"); await target.button("Movies", '[aria-label="Library view"]');
  await target.button(`Details for ${title}`); await target.button("Edit metadata");
  await until("metadata editor loads the current title", () => target.execute("return document.querySelector('[data-metadata-field=title]')?.value === arguments[0]", [title]));
}
async function capture(name: string) {
  await ui.execute("document.querySelectorAll('.pairing-display, .pair-shortcut strong, [data-administrator-code]').forEach(element => element.style.visibility = 'hidden')");
  const child = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", `${artifacts}/${name}.png`], { stdout: "ignore", stderr: "inherit" }); assert.equal(await child.exited, 0);
}
async function fixtures() {
  await mkdir("/mnt/metadata-fixtures/Show", { recursive: true });
  const child = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "90", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-c:a", "aac", "/mnt/metadata-fixtures/Movie.mkv"], { stdout: "inherit", stderr: "inherit" }); assert.equal(await child.exited, 0);
  await Bun.write("/mnt/metadata-fixtures/Movie.nfo", '<movie><title>Wrong movie</title><year>2020</year><custom keep="yes">Preserve me</custom></movie>');
  await Bun.write("/mnt/metadata-fixtures/Show/Example.S01E07.mkv", Bun.file("/mnt/metadata-fixtures/Movie.mkv"));
  await Bun.write("/mnt/metadata-fixtures/Show/Example.S01E07.nfo", '<episodedetails><title>Wrong episode</title><season>1</season><episode>7</episode><unknown>Keep episode field</unknown></episodedetails>');
  await Bun.write("/mnt/metadata-fixtures/Show/tvshow.nfo", '<tvshow><title>Generated series</title></tvshow>');
  await Bun.write("/mnt/invalid-metadata-artwork.png", "not an image");
  await Bun.write("/mnt/metadata-artwork.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aJcAAAAASUVORK5CYII=", "base64"));
}
class Remote {
  state: SessionState | null = null;
  socket!: WebSocket;
  pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

  constructor(readonly token: string) { this.connect(); }

  connect() {
    this.state = null;
    this.socket = new BunWebSocket(`${origin.replace("http", "ws")}/api/ws?token=${this.token}`, { headers: { origin } });
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
  await until("Tauri driver is ready", async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  await launch(); await ui.key(keys.escape); await ui.click(".pair-shortcut");
  const code = await ui.execute("return document.querySelector('.pairing-display strong')?.textContent") as string;
  await ui.key(keys.escape);
  for (let index = 0; index < 2; index++) {
    const response = await fetch(`${origin}/api/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) }); assert.equal(response.status, 200);
    clients.push(new Remote((await response.json()).token));
  }
  await until("two independent controllers receive idle snapshots", () => all(state => state.player.status === "idle"));
  phone = await startHttpRemote(origin, code, artifacts, until, 4446, 1.5);
  await phone.minimize(); await ui.button("Settings");
  await until("TV shows its one-use administrator code", () => ui.execute("return /^\\d{10}$/.test(document.querySelector('[data-administrator-code]')?.textContent ?? '')"));
  const claimCode = await ui.execute("return document.querySelector('[data-administrator-code]').textContent") as string;
  await phone.restore(); await phone.ui.button("Settings"); await keyboard(phone.ui, "#administrator-code", claimCode); await phone.ui.button("Claim administrator");
  await until("real phone claim grants administration", () => phone!.ui.execute("return !!document.querySelector('#tv-name') && !document.querySelector('#administrator-code')"));
  administrator = await phone.ui.execute("return localStorage.getItem('couch.remote-token')") as string;
  await phone.ui.key(keys.escape); await phone.minimize(); await ui.key(keys.escape);
  const source = await addTVFolder(ui, until, "metadata-fixtures");
  await until("scanner imports the generated movie and episode", async () => (await data("/api/library/items")).total === 2);
  const movie = (await data("/api/library/items?videoType=movie")).items[0];
  const episode = (await data("/api/library/items?videoType=episode")).items[0];
  const view = (): Promise<MetadataView> => data(`/api/metadata/items/${movie.id}`);
  await movieEditor(ui, "Wrong movie");
  await keyboard(ui, '[data-metadata-field="title"]', "Correct movie");
  await ui.execute("document.documentElement.removeAttribute('data-keyboard'); [...document.querySelectorAll('.metadata-editor button')].find(button => button.textContent === 'Save corrections').focus()");
  const before = await view(), beforeVersion = clients[0]!.state!.libraryVersion;
  await clients[1]!.command({ type: "navigate", key: "select" });
  await until("guest selection reaches the real native navigation handler", () => ui.execute("return document.documentElement.hasAttribute('data-keyboard')"));
  await ui.request(`/session/${ui.session()}/execute/async`, { script: "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(null)));", args: [] });
  assert.equal((await view()).revision, before.revision, "guest navigation cannot activate a protected metadata save");
  await ui.button("Save corrections");
  await until("native title correction commits and both controllers receive invalidation", async () => (await view()).values.title === "Correct movie" && all(state => state.libraryVersion > beforeVersion && state.libraryVersion === clients[0]!.state!.libraryVersion));
  await capture("native-metadata-editor");
  assert.equal(await ui.execute("return document.querySelector('.metadata-editor').textContent.includes('On your paired administrator phone or browser')"), true);
  await ui.key(keys.escape); await ui.button("Play Correct movie"); await ui.watching();
  await until("metadata correction preserves native playback", () => all(state => state.player.status === "playing" && state.player.position > 1));
  await assertNativeVideoPixels(ui.execute, artifacts, "metadata-playing", [253, 0, 0]); await assertNativeUiPixels(ui.execute, artifacts);
  await clients[0]!.command({ type: "stop" }); await until("Stop is current on both controllers", () => all(state => state.player.status === "idle"));
  await movieEditor(ui, "Correct movie");
  await phone.restore(); await movieEditor(phone.ui, "Correct movie");
  await keyboard(phone.ui, '[data-metadata-field="title"]', "Phone correction");
  const upload = await phone.ui.element("[data-metadata-artwork]");
  await phone.ui.request(`/session/${phone.ui.session()}/element/${upload}/value`, { text: "/mnt/invalid-metadata-artwork.png" });
  await until("phone file input reads the invalid image fixture", () => phone!.ui.execute("return document.querySelector('.metadata-editor').textContent.includes('Artwork selected')"));
  await phone.ui.button("Save corrections");
  await until("invalid artwork rejects the whole phone correction", () => phone!.ui.execute("return document.querySelector('.metadata-editor [role=alert]')?.textContent.includes('Artwork must')"));
  assert.equal((await view()).values.title, "Correct movie"); assert.equal((await view()).values.artworkId, null);
  await phone.ui.request(`/session/${phone.ui.session()}/element/${upload}/value`, { text: "/mnt/metadata-artwork.png" });
  await until("phone file input reads actual artwork", () => phone!.ui.execute("return document.querySelector('.metadata-editor').textContent.includes('Artwork selected')"));
  await phone.ui.button("Save corrections");
  await until("phone saves its title and artwork together", async () => { const current = await view(); return current.values.title === "Phone correction" && !!current.values.artworkId; });
  await phone.screenshot("phone-metadata-editor"); await phone.minimize();
  await keyboard(ui, '[data-metadata-field="title"]', "Stale TV correction"); await ui.button("Save corrections");
  await until("TV keeps its stale draft with an explicit reload error", () => ui.execute("return document.querySelector('.metadata-editor [role=alert]')?.textContent.includes('Reload') && document.querySelector('[data-metadata-field=title]').value === 'Stale TV correction'"));
  assert.equal((await view()).values.title, "Phone correction");
  await phone.restore(); await phone.ui.button("Search TMDB");
  await until("missing TMDB access leaves metadata untouched and explains setup", () => phone!.ui.execute("return document.querySelector('.metadata-editor [role=alert]')?.textContent.includes('authorized TMDB')"));
  assert.equal((await view()).values.title, "Phone correction");
  await phone.ui.button("Download saved metadata");
  const download = `${artifacts}/downloads/couch-metadata-${movie.id}.tar`;
  await until("the administrator browser writes its explicit archive download", () => Bun.file(download).exists());
  const files = await new Bun.Archive(await Bun.file(download).bytes()).files();
  const nfo = await files.get("metadata.nfo")!.text(); assert.ok(nfo.includes('<custom keep="yes">Preserve me</custom>')); assert.ok(nfo.includes("<title>Phone correction</title>"));
  await mkdir("/mnt/metadata-reimport", { recursive: true });
  await Bun.write("/mnt/metadata-reimport/Movie.mkv", Bun.file("/mnt/metadata-fixtures/Movie.mkv"));
  await Bun.write("/mnt/metadata-reimport/Movie.nfo", nfo); await Bun.write("/mnt/metadata-reimport/Movie-poster.png", files.get("artwork-0.png")!);
  const added = await api("/api/library/sources", { path: "/mnt/metadata-reimport" }); assert.equal(added.status, 201);
  const imported = (await added.json()).sources.find((source: any) => source.path === "/mnt/metadata-reimport"); assert.ok(imported);
  await data(`/api/library/sources/${imported.id}/scan`, {});
  const exportedArtwork = (await view()).values.artworkId;
  await until("exported NFO and artwork reimport with the same correction", async () => (await data("/api/library/items?q=Phone%20correction")).items.filter((item: any) => item.artworkId === exportedArtwork).length === 2);
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    for (let attempt = 0; attempt < 3; attempt++) { const rect = await phone.ui.request(`/session/${phone.ui.session()}/window/rect`); const actual = await phone.ui.execute("return innerWidth"); if (actual === width) break; await phone.ui.request(`/session/${phone.ui.session()}/window/rect`, { width: Math.round(rect.width * width / actual), height: 950 }); }
    await until(`metadata editor reaches ${width} CSS pixels`, () => phone!.ui.execute("return innerWidth === arguments[0]", [width]));
    await assertResponsive(phone.ui, `Metadata editor ${width}`); await phone.screenshot(`metadata-editor-${width}`);
  }
  await phone.restore(); await phone.ui.key(keys.escape);
  await phone.ui.section("Library"); await phone.ui.button("Shows", '[aria-label="Library view"]');
  await phone.ui.button("Browse Generated series seasons"); await phone.ui.button("Browse Season 1");
  await phone.ui.button("Details for Wrong episode"); await phone.ui.button("Edit metadata");
  await until("phone episode editor loads imported order", () => phone!.ui.execute("return document.querySelector('[data-metadata-field=episode]')?.value === '7'"));
  await keyboard(phone.ui, '[data-metadata-field="season"]', "2"); await keyboard(phone.ui, '[data-metadata-field="episode"]', "4");
  await phone.ui.button("Save corrections");
  await until("phone episode order correction commits", async () => { const saved = await data(`/api/metadata/items/${episode.id}`); return saved.values.season === 2 && saved.values.episode === 4 && saved.origins.episode === "Manual"; });
  await phone.screenshot("phone-episode-order");
  await rename("/mnt/metadata-fixtures", "/mnt/metadata-offline"); await data(`/api/library/sources/${source}/scan`, {});
  assert.equal((await view()).values.title, "Phone correction");
  assert.equal(await readFile("/mnt/metadata-offline/Movie.nfo", "utf8"), '<movie><title>Wrong movie</title><year>2020</year><custom keep="yes">Preserve me</custom></movie>');
  await phone.minimize(); await webdriver(`/session/${sessionId}`, undefined, "DELETE"); sessionId = "";
  await launch(); for (const client of clients) client.connect();
  await until("offline restart reconnects both controllers without autoplay", () => all(state => state.player.status === "idle"));
  assert.equal((await view()).values.title, "Phone correction"); assert.equal((await view()).origins.title, "Manual");
  await phone.restore(); await phone.refresh(); await until("administrator phone reconnects after restart", () => phone!.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  await movieEditor(phone.ui, "Phone correction"); await phone.screenshot("phone-metadata-offline-restart");
  await Bun.write(`${artifacts}/metadata-results.json`, JSON.stringify({ status: "passed", source: process.env.COUCH_QUALIFICATION_HEAD, checks, widths: [320,375,390,768,1024,1440,1920], liveTmdb: "blocked: owner has no authorized API access", scope: "Ubuntu software rendering and null audio; no physical hardware claim" }, null, 2));
} catch (error) {
  await Bun.write(`${artifacts}/metadata-results.json`, JSON.stringify({ status: "failed", checks, error: String(error) }, null, 2));
  if (phone) { await phone.screenshot("phone-metadata-failure").catch(() => {}); await Bun.write(`${artifacts}/phone-failure-dom.txt`, String(await phone.ui.execute("return document.body.innerText").catch(() => ""))); }
  if (sessionId) { await capture("native-metadata-failure").catch(() => {}); await Bun.write(`${artifacts}/native-failure-dom.txt`, String(await ui.execute("return document.body.innerText").catch(() => ""))); }
  throw error;
} finally {
  for (const client of clients) client.socket.close(); await phone?.close();
  if (sessionId) await webdriver(`/session/${sessionId}`, undefined, "DELETE").catch(() => {});
  driver.kill(); await driver.exited;
}
