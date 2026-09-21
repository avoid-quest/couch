import { strict as assert } from "node:assert";
import type { Action, SessionState } from "../../src/shared/protocol";
import { assertResponsive, type UiDriver, type Wait, type startHttpRemote } from "./ui";

type Remote = { token: string; state: SessionState | null; command: (action: Action) => Promise<void> };
type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type Context = { origin: string; ui: UiDriver; httpRemote: HttpRemote; clients: readonly Remote[]; until: Wait; artifactDir: string };
const settings = '[aria-label="Jellyfin settings"]';

export async function verifyJellyfinSettings({ origin, httpRemote, clients, until, artifactDir }: Context) {
  if (!process.env.COUCH_TEST_JELLYFIN) return null;
  const config = await Bun.file(process.env.COUCH_TEST_JELLYFIN).json() as { containerUrl: string; username: string; password: string; accessToken: string };
  const phone = httpRemote.ui;
  const originalQueue = clients[0]!.state!.queue.map(entry => entry.id);
  const originalProfile = clients[0]!.state!.activeProfile;
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => !!client.state && predicate(client.state));
  const api = async (path: string) => {
    const response = await fetch(`${origin}${path}`, { headers: { authorization: `Bearer ${clients[1]!.token}` } });
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  };
  const upstream = async (path: string, body?: unknown, token = config.accessToken) => {
    const response = await fetch(`${config.containerUrl}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "X-Emby-Token": token, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `Disposable Jellyfin fixture ${path} returns ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const replacement = await upstream("/Users/New", { Name: "Settings replacement" }) as { Id: string };
  await upstream(`/Users/Password?userId=${replacement.Id}`, { NewPw: config.password });
  let token = "";
  const startProxy = () => Bun.serve({ hostname: "127.0.0.1", port: 4203, async fetch(request) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("accept-encoding", "identity");
    const response = await fetch(`${config.containerUrl}${url.pathname}${url.search}`, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual" });
    if (url.pathname === "/Users/AuthenticateByName" && response.ok) token = (await response.clone().json() as { AccessToken: string }).AccessToken;
    return response;
  } });
  let proxy = startProxy();
  const url = "http://127.0.0.1:4203";
  const close = async () => { await phone.section("Jellyfin"); await phone.type("#media-search", "Linux playback fixture"); };
  const open = async () => {
    await phone.button("Settings");
    await phone.settingsSection("source-jellyfin");
    await until("phone browse opens the canonical Jellyfin Sources form", () => phone.execute("return document.querySelectorAll(arguments[0]).length === 1 && !!document.querySelector('[data-action=jellyfin-disconnect]:not(:disabled), #jellyfin-url:not(:disabled)')", [settings]));
  };
  const connect = async (server: string, username = config.username, password = config.password) => {
    await phone.type("#jellyfin-url", server);
    await phone.type("#jellyfin-user", username);
    await phone.type("#jellyfin-password", password);
    await phone.button((await api("/api/jellyfin")).connected ? "Test and replace connection" : "Test and connect", settings);
  };
  const saved = async (username: string) => until("phone connection test saves the selected Jellyfin account", async () => (await api("/api/jellyfin")).username === username && await phone.execute("return !document.querySelector('.jellyfin-connect') && document.querySelector(arguments[0])?.textContent.includes('Connection tested and saved.')", [settings]), 30_000);
  const disconnect = async () => {
    await phone.click('[data-action="jellyfin-disconnect"]');
    assert.equal(await phone.execute("return document.querySelector(arguments[0]).textContent.includes('stops any item playing')", [settings]), true);
    await phone.button("Disconnect and stop Jellyfin", settings);
    await until("phone disconnect removes the saved connection and stops its native playback", async () => !(await api("/api/jellyfin")).connected && all(state => state.player.status === "idle") && await phone.execute("return !!document.querySelector('#jellyfin-url:not(:disabled)')"));
  };
  const play = async () => {
    await close();
    await until("phone Jellyfin browse offers the real fixture movie", () => phone.execute("return !!document.querySelector('[aria-label=\"Jellyfin search results\"] [aria-label=\"Play: Linux playback fixture\"]:not(:disabled), [aria-label=\"Jellyfin search results\"] [aria-label=\"Resume: Linux playback fixture\"]:not(:disabled)')"));
    const previous = clients[0]!.state!.player.playbackId;
    await phone.click('[aria-label="Jellyfin search results"] [aria-label="Play: Linux playback fixture"], [aria-label="Jellyfin search results"] [aria-label="Resume: Linux playback fixture"]');
    await until("phone Jellyfin play uses the one native player and reaches both paired remotes", () => all(state => state.player.status === "playing" && state.player.playbackId !== previous && state.player.position > 0.5), 30_000);
    await httpRemote.screenshot("jellyfin-phone-browse-play");
    assert.equal(await phone.execute("return !!document.querySelector('.video-stage')"), false, "The HTTP phone remains a controller without its own video stage");
    await open();
  };
  try {
    await httpRemote.restore();
    await open();
    await disconnect();
    await connect(url);
    await saved(config.username);
    await assertResponsive(phone, "Phone Jellyfin Sources");
    await httpRemote.screenshot("jellyfin-phone-connected");
    await phone.button("Test connection", settings);
    await until("phone verifies its saved token with real Jellyfin", () => phone.execute("return document.querySelector(arguments[0])?.textContent.includes('accepted the saved connection')", [settings]));
    await play();
    await phone.button("Reconnect or replace", settings);
    await connect(url, "Settings replacement", "wrong-fixture-password");
    await until("phone failed replacement reports an inline error and clears its password", () => phone.execute("return !!document.querySelector(arguments[0] + ' [role=alert]') && document.querySelector('#jellyfin-password')?.value === ''", [settings]));
    assert.equal((await api("/api/jellyfin")).username, config.username, "A failed replacement leaves the previous shared connection working");
    const version = clients[0]!.state!.jellyfinVersion ?? 0;
    await clients[0]!.command({ type: "pause", playbackId: clients[0]!.state!.player.playbackId!, paused: true });
    await until("normal Jellyfin playback progress refreshes the catalog while replacement has failed", () => all(state => (state.jellyfinVersion ?? 0) > version));
    assert.equal(await phone.execute("return !!document.querySelector(arguments[0] + ' [role=alert]') && document.querySelector('#jellyfin-password')?.value === ''", [settings]), true, "Background Jellyfin progress refresh keeps the failed replacement's inline error visible");
    await assertResponsive(phone, "Phone Jellyfin replacement failure");
    await httpRemote.screenshot("jellyfin-phone-replacement-failure");
    await phone.button("Cancel", settings);
    await play();
    await clients[0]!.command({ type: "stop" });
    assert.ok(token, "The fixture proxy observed the Couch login without exposing its token to a controller");
    await upstream("/Sessions/Logout", {}, token);
    await phone.button("Test connection", settings);
    await until("phone detects an actually revoked Jellyfin access token", () => phone.execute("return document.querySelector(arguments[0] + ' [role=alert]')?.textContent.includes('rejected the saved connection')", [settings]));
    await httpRemote.screenshot("jellyfin-phone-expired-credentials");
    await phone.button("Reconnect or replace", settings);
    await connect(url);
    await saved(config.username);
    await proxy.stop(true);
    await phone.button("Test connection", settings);
    await until("phone shows an inline unavailable-server error when the configured listener is stopped", () => phone.execute("return document.querySelector(arguments[0] + ' [role=alert]')?.textContent.includes('Could not reach')", [settings]), 30_000);
    await httpRemote.screenshot("jellyfin-phone-unavailable-server");
    proxy = startProxy();
    await phone.button("Reconnect or replace", settings);
    await connect(url, "Settings replacement");
    await saved("Settings replacement");
    assert.deepEqual(clients[0]!.state!.activeProfile, originalProfile, "Replacing the Jellyfin account leaves the Couch watching profile unchanged");
    assert.equal((await api("/api/controllers/me")).authority, "controller", "The Jellyfin account cannot promote a paired device");
    await httpRemote.screenshot("jellyfin-phone-replaced-account");
    await play();
    await disconnect();
    await httpRemote.screenshot("jellyfin-phone-disconnected");
    await connect(config.containerUrl);
    await saved(config.username);
    await close();
    for (const entry of clients[0]!.state!.queue) if (!originalQueue.includes(entry.id)) await clients[0]!.command({ type: "remove", entryId: entry.id });
    await until("Jellyfin Settings acceptance restores the original queue and idle player", () => all(state => state.player.status === "idle" && JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(originalQueue)));
    for (const client of clients) for (const secret of [token, config.password, config.accessToken, config.containerUrl, url]) assert.ok(!JSON.stringify(client.state).includes(secret), "Shared state contains no Jellyfin credentials or server address");
    await Bun.write(`${artifactDir}/jellyfin-settings.json`, JSON.stringify({ environment: "Ubuntu 24.04 native Tauri/libmpv under Xvfb and a real 390px HTTP WebKit phone; no physical display or audio claim", server: "Disposable Jellyfin 10.11.11 with a local forwarding listener", tested: ["phone connect and saved-token test", "ordinary controller browse and phone native play", "failed replacement preserves original account", "actual Couch token revoked through Jellyfin logout", "configured listener stopped and restored", "replacement account remains separate from profile and role", "phone disconnect stops native playback", "original connection and queue restored"], passwordClearedAfterFailure: true, sharedStateSanitized: true, profilePreserved: true }, null, 2));
    await httpRemote.minimize();
    return { verifyAfterRestart: async () => {
      await httpRemote.restore();
      await open();
      await until("phone Sources reloads the preserved original Jellyfin connection after native restart", async () => (await api("/api/jellyfin")).username === config.username && await phone.execute("return document.querySelector(arguments[0])?.textContent.includes(arguments[1])", [settings, config.containerUrl]));
      await phone.button("Test connection", settings);
      await until("preserved Jellyfin credentials still pass after native restart", () => phone.execute("return document.querySelector(arguments[0])?.textContent.includes('accepted the saved connection')", [settings]));
      await close();
      await httpRemote.minimize();
    } };
  } finally { await proxy.stop(true); }
}
