import { seedConfiguredFixture } from "./configured-fixture";
seedConfiguredFixture();
import { strict as assert } from "node:assert";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import { remoteSocketUrl } from "./build";
import { assertNativeVideoPixels } from "./pixels";
import { UiDriver, keys } from "./ui";

const origin = "http://127.0.0.1:4100", driverOrigin = "http://127.0.0.1:4444";
const url = "https://www.youtube.com/watch?v=YE7VzlLtp-4";
const revision = process.env.COUCH_SOURCE_REVISION!;
const checks: string[] = [];
const until = async (description: string, ready: () => boolean | Promise<boolean>, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (!await ready()) {
    assert.ok(Date.now() < deadline, description);
    await Bun.sleep(100);
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
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file("/artifacts/public-provider-driver.log"), stderr: Bun.file("/artifacts/public-provider-native.log") });
const write = (result: Record<string, unknown>) => Bun.write("/artifacts/public-provider.json", JSON.stringify({ revision, url, checks, ...result }, null, 2));

try {
  await until("provider WebDriver starts", async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until("provider desktop connects", async () => (await tv.elements("xpath", '//*[@role="status" and normalize-space(.)="Connected"]')).length > 0);
  await tv.button("Settings");
  await tv.settingsSection("connection");
  await tv.button("Pair a remote", 'section[aria-label="Settings"]');
  await until("provider pairing code appears", async () => /^\d{6}$/.test(await tv.pairingCode().catch(() => "")));
  const code = await tv.pairingCode();
  await tv.key(keys.escape);
  const paired = await fetch(`${origin}/api/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  assert.equal(paired.status, 200);
  const token = (await paired.json() as { token: string }).token;
  controller = new (WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket })(await remoteSocketUrl(origin, token), { headers: { origin } });
  controller.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") state = message.state;
  };
  await until("provider controller sees idle native player", () => state?.player.status === "idle");
  const build = await (await fetch(`${origin}/api/build`, { headers: { Authorization: `Bearer ${token}` } })).json() as { revision: string; dirty: boolean };
  assert.equal(build.revision, revision);
  assert.equal(build.dirty, false);
  const entryId = crypto.randomUUID();
  const action: Action = { type: "enqueueWeb", entryId, url, title: "Big Buck Bunny", quality: "720p", playNow: true };
  controller.send(JSON.stringify({ type: "command", requestId: crypto.randomUUID(), action }));
  await until("public provider queues the named source", () => state?.queue.some(entry => entry.id === entryId) === true, 45_000);
  await until("public provider plays native audio and video", () => {
    if (state?.currentEntryId === entryId && state.player.status === "error") throw new Error(`Public provider playback failed: ${state.player.error ?? "unknown"}`);
    return state?.currentEntryId === entryId && state.player.status === "playing" && state.player.tracks?.some(track => track.kind === "audio") && state.player.tracks.some(track => track.kind === "video");
  }, 90_000);
  await tv.watching();
  await assertNativeVideoPixels(tv.execute, "/artifacts", "native-public-provider");
  checks.push("public provider presents native video pixels");
  await write({ status: "passed", tracks: state!.player.tracks?.map(track => track.kind), limitations: "Xvfb and a null audio sink; no physical output qualification." });
} catch (error) {
  await write({ status: "failed", phase: checks.at(-1) ?? "startup", error: error instanceof Error ? error.message : String(error), playerStatus: state?.player.status ?? null });
  throw error;
} finally {
  controller?.close();
  if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill();
  await driver.exited;
}
