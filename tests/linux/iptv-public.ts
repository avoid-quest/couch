import { seedConfiguredFixture } from "./configured-fixture";
seedConfiguredFixture();
import { strict as assert } from "node:assert";
import type { ServerMessage, SessionState } from "../../src/shared/protocol";
import { remoteSocketUrl } from "./build";
import { createGuideFixture } from "./iptv-fixture";
import { assertNativeVideoPixels } from "./pixels";
import { UiDriver, keys, type Wait } from "./ui";

// Public playback is opt-in evidence. The ordinary smoke never reaches this URL.
const origin = "http://127.0.0.1:4100", driverOrigin = "http://127.0.0.1:4444", artifacts = "/artifacts";
const revision = process.env.COUCH_SOURCE_REVISION!;
const checks: string[] = [];
const until: Wait = async (description, predicate, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, description);
    await Bun.sleep(50);
  }
  checks.push(description);
  console.log(`PASS ${description}`);
};
const request = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
  const response = await fetch(driverOrigin + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const value = await response.json() as { value: any };
  assert.ok(response.ok && !value.value?.error, `WebDriver ${path} failed (${response.status}, ${value.value?.error ?? "unknown"})`);
  return value.value;
};
let session = "", state: SessionState | undefined, controller: WebSocket | undefined;
const tv = new UiDriver(request, () => session);
const guide = await createGuideFixture(4202, "ffmpeg", artifacts);
const connect = async (token: string) => {
  state = undefined;
  controller = new (WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket })(await remoteSocketUrl(origin, token), { headers: { origin } });
  controller.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") state = message.state;
  };
};
const start = async () => {
  session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until("public IPTV desktop app connects", async () => (await tv.elements("xpath", '//*[@role="status" and normalize-space(.)="Connected"]')).length > 0);
};

await Bun.write(`${artifacts}/iptv.json`, JSON.stringify({ externalQualification: "running", revision }, null, 2));
try {
  await guide.startStreams();
  const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/iptv-public-driver.log`), stderr: Bun.file(`${artifacts}/iptv-public-native.log`) });
  try {
    await until("public IPTV WebDriver starts", async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
    await start();
    await tv.button("Settings");
    await tv.settingsSection("connection");
    await tv.button("Pair a remote", 'section[aria-label="Settings"]');
    await until("public IPTV pairing code is visible", async () => /^\d{6}$/.test(await tv.pairingCode().catch(() => "")));
    const code = await tv.pairingCode();
    await tv.key(keys.escape);
    const paired = await fetch(`${origin}/api/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    assert.equal(paired.status, 200);
    const token = (await paired.json() as { token: string }).token;
    await connect(token);
    await until("public IPTV controller receives native state", () => state?.player.status === "idle");
    const api = (path: string, body?: unknown) => fetch(`${origin}/api/iptv/${path}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal((await api("sources", guide.definition)).status, 201);
    let channels: Array<{ id: string; tvgId: string }> = [];
    await until("generated IPTV source imports", async () => {
      const page = await (await api("guide")).json() as { channels: typeof channels };
      channels = page.channels;
      return channels.length === 4;
    });
    const red = channels.find(channel => channel.tvgId === "red")!, apple = channels.find(channel => channel.tvgId === "apple")!;
    assert.equal((await api(`channels/${red.id}/play`, {})).status, 200);
    await until("generated IPTV video reaches native libmpv", () => state?.queue.find(entry => entry.id === state.currentEntryId)?.source === `iptv:${red.id}` && state.player.status === "playing" && state.player.tracks?.some(track => track.kind === "video") && state.player.tracks?.some(track => track.kind === "audio"));
    await tv.watching();
    await assertNativeVideoPixels(tv.execute, artifacts, "native-iptv-generated", [253, 0, 0]);

    controller.close();
    await request(`/session/${session}`, undefined, "DELETE");
    session = "";
    await until("public IPTV desktop app shutdown releases its sidecar", async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } });
    await start();
    await connect(token);
    await until("generated IPTV source persists across restart", async () => state?.player.status === "idle" && (await (await api("guide")).json() as { channels: unknown[] }).channels.length === 4);
    assert.equal((await api(`channels/${apple.id}/play`, {})).status, 200);
    await until("authorized Apple Bip Bop sample plays native audio and video", () => state?.queue.find(entry => entry.id === state.currentEntryId)?.source === `iptv:${apple.id}` && state.player.status === "playing" && state.player.tracks?.some(track => track.kind === "video") && state.player.tracks?.some(track => track.kind === "audio"), 45_000);
    await tv.watching();
    await Bun.write(`${artifacts}/native-iptv-apple-sample.png`, Buffer.from(await tv.request(`/session/${session}/screenshot`), "base64"));
    await Bun.write(`${artifacts}/iptv.json`, JSON.stringify({ externalQualification: "passed", revision, generated: guide.hashes, publicSample: "Apple Bip Bop", checks, limitations: "Opt-in external evidence under Xvfb and a null sink, not physical audio or display qualification." }, null, 2));
  } finally {
    controller?.close();
    if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
    driver.kill();
    await driver.exited;
  }
} catch (error) {
  await Bun.write(`${artifacts}/iptv.json`, JSON.stringify({ externalQualification: "failed", revision, checks, error: String(error) }, null, 2));
  throw error;
} finally { await guide.close(); }
