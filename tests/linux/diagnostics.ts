import { seedConfiguredFixture } from "./configured-fixture";
seedConfiguredFixture();
import { remoteSocketUrl } from "./build";
import { strict as assert } from "node:assert";
import type { Diagnostics } from "../../src/shared/diagnostics";
import type { SessionState } from "../../src/shared/protocol";
import { assertPlaybackDiagnosticFacts } from "./diagnostics-facts";
import { UiDriver, assertResponsive, keys, startHttpRemote, type Wait } from "./ui";

// Focused qualification, run under the same disposable Xvfb/PulseAudio setup
// as playback.ts after building this tree. It does not use the installed TV.
const origin = "http://127.0.0.1:4100", artifacts = "/artifacts";
const checks: string[] = [];
const until: Wait = async (description, predicate, timeout = 15_000) => {
  const end = Date.now() + timeout;
  while (!await predicate()) { assert.ok(Date.now() < end, description); await Bun.sleep(50); }
  checks.push(description); console.log(`PASS ${description}`);
};
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/diagnostics-driver.log`), stderr: Bun.file(`${artifacts}/diagnostics-native.log`) });
let session = "", phone: Awaited<ReturnType<typeof startHttpRemote>> | undefined, socket: WebSocket | undefined;
const request = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
  const response = await fetch(`http://127.0.0.1:4444${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const value = await response.json() as { value: any };
  assert.ok(response.ok && !value.value?.error, `WebDriver ${path} succeeded`);
  return value.value;
};
const tv = new UiDriver(request, () => session);
const media = Bun.serve({ hostname: "127.0.0.1", port: 4200, fetch: () => new Response(Bun.file("/mnt/fixtures/multitrack.mkv")) });
try {
  await until("diagnostics native driver starts", async () => { try { return (await fetch("http://127.0.0.1:4444/status")).ok; } catch { return false; } });
  session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until("configured native app exposes Settings", () => tv.execute("return !!document.querySelector('[data-app-nav] a[href^=\"/settings\"]')"));
  await tv.button("Settings"); await tv.settingsSection("connection");
  await tv.button("Pair a remote", 'section[aria-label="Settings"]');
  await until("pairing dialog loads its current code", () => tv.execute("return /^[0-9]{6}$/.test(document.querySelector('[role=dialog] [data-pairing-code]')?.textContent || '')"));
  const code = await tv.execute("return document.querySelector('[role=dialog] [data-pairing-code]').textContent") as string;
  await tv.key(keys.escape);
  phone = await startHttpRemote(origin, code, artifacts, until);
  const token = await phone.ui.execute("return localStorage.getItem('couch.remote-token')") as string;
  const api = (path: string, credential = token) => fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(5_000) });
  const paired = await fetch(`${origin}/api/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const guest = (await paired.json() as { token: string }).token;
  assert.equal((await (await api("/api/controllers/me")).json() as { authority: string }).authority, "administrator", "The first paired remote is the administrator");
  for (const path of ["/api/diagnostics", "/api/diagnostics/export"]) assert.equal((await api(path, guest)).status, 403);
  await phone.ui.browse(); await phone.ui.button("Settings");
  await phone.ui.settingsSection("advanced");
  await until("Advanced displays an idle native report", () => phone!.ui.execute("return document.querySelector('[data-advanced-settings]')?.textContent.includes('Private coordinator pipe')"));
  await assertResponsive(phone.ui, "Advanced diagnostics phone");
  await phone.screenshot("diagnostics-phone-idle");
  const idle = await (await api("/api/diagnostics")).json() as Diagnostics;
  assert.equal(idle.native?.facts.find(fact => fact.name === "Native host")?.value, "Ready");
  assert.equal(idle.native?.facts.find(fact => fact.name === "Hardware decoder")?.value, null);
  assert.ok(idle.system.some(fact => fact.name === "Available storage in bytes" && typeof fact.value === "number"));
  assert.ok(idle.helpers.some(helper => helper.name === "ffprobe" && helper.status === "ready"));
  assert.ok(idle.helpers.every(helper => helper.status === "ready"), "The fixture's shipped helper versions answer");
  await phone.ui.key(keys.escape); await phone.minimize();
  let state: SessionState | null = null;
  const NativeWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  socket = new NativeWebSocket(await remoteSocketUrl(origin, guest), { headers: { origin } });
  socket.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.type === "state") state = message.state; };
  await until("ordinary remote receives player state", () => state !== null);
  await tv.section("Find");
  await tv.type("#media-search", "http://127.0.0.1:4200/fixture.mkv");
  await until("Find offers the diagnostic fixture link", () => tv.execute("return !!document.querySelector('[aria-label=\"Pasted link\"]')"));
  await tv.button("Direct media", '[aria-label="Pasted link"]');
  await tv.button("Play", '[aria-label="Pasted link"]');
  await until("native queue contains the diagnostic fixture", () => state?.queue.some(entry => entry.source === "http://127.0.0.1:4200/fixture.mkv") === true);
  await until("diagnostic fixture plays through native mpv", () => state?.player.status === "playing" && state.player.position > 0.5);
  const before = state!.player;
  // The idle report is cached for five seconds. Wait for a fresh observation.
  await Bun.sleep(Math.max(0, Date.parse(idle.collectedAt) + 5_050 - Date.now()));
  const collectionStarted = performance.now();
  const exported = await api("/api/diagnostics/export");
  const collectionRequestMs = performance.now() - collectionStarted;
  assert.equal(exported.status, 200); assert.match(exported.headers.get("content-disposition")!, /attachment/);
  const body = await exported.text(), report = JSON.parse(body) as Diagnostics;
  assert.ok(Buffer.byteLength(body) <= report.limits.exportBytes);
  for (const secret of [code, token, guest, "http://127.0.0.1:4200/fixture.mkv"]) assert.ok(!body.includes(secret));
  const facts = report.native!.facts;
  assertPlaybackDiagnosticFacts(facts);
  assert.equal(facts.find(fact => fact.name === "Hardware decoder")?.value, "no", "Xvfb fixture truthfully reports software decoding");
  await until("diagnostic collection leaves the same playback advancing", () => state?.player.playbackId === before.playbackId && state.player.position > before.position && state.player.status === "playing");
  for (const path of ["/api/diagnostics", "/api/diagnostics/export"]) assert.equal((await api(path, guest)).status, 403);
  await phone.restore(); await phone.ui.browse(); await phone.ui.button("Settings"); await phone.ui.settingsSection("advanced");
  await until("phone shows the observed software decoder", () => phone!.ui.execute("return [...document.querySelectorAll('[data-advanced-settings] dt')].some(term => term.textContent === 'Hardware decoder' && term.nextElementSibling?.textContent.startsWith('no'))"));
  await assertResponsive(phone.ui, "Advanced native playback details"); await phone.screenshot("diagnostics-phone-playing");
  await phone.ui.button("Export", "[data-advanced-settings]");
  await until("phone starts its explicit diagnostic download", () => phone!.ui.execute("return document.body.textContent.includes('Downloaded.')"));
  await Bun.write(`${artifacts}/diagnostics-bundle.json`, body);
  await Bun.write(`${artifacts}/diagnostics-acceptance.json`, JSON.stringify({
    sourceRevision: process.env.COUCH_SOURCE_REVISION,
    telemetryEnabled: process.env.TAURI_VIDEO_TELEMETRY === "1",
    checks,
    observed: facts,
    collectionMs: report.collectionMs,
    collectionRequestMs,
    bytes: Buffer.byteLength(body),
    stuckRenderLog: { pattern: "mpv_render_context_render() not being called or stuck", observation: "unavailable", reason: "The vendored libmpv binding does not subscribe to mpv log messages." },
    physicalHardware: false,
  }, null, 2));
} finally {
  socket?.close(); await phone?.close();
  if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill(); await driver.exited; await media.stop(true);
}
