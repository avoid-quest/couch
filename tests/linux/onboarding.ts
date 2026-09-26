import { strict as assert } from "node:assert";
import { UiDriver, assertResponsive, startHttpRemote, type Wait } from "./ui";
import { mkdir } from "node:fs/promises";
import { addTVFolder } from "./folder-settings";
import { assertNativeVideoPixels } from "./pixels";
import { remoteSocketUrl } from "./build";
import type { SessionState } from "../../src/shared/protocol";
import type { SoundState } from "../../src/shared/sound";

// Run on an empty COUCH_DATA_DIR with the joined native build, virtual X11
// outputs and a Pulse-compatible null sink. These are not physical confirmations.
const origin = "http://127.0.0.1:4100", artifacts = "/artifacts";
assert.ok(process.env.COUCH_DATA_DIR, "Set an isolated first-run data directory");
assert.equal(await Bun.file(`${process.env.COUCH_DATA_DIR}/couch.sqlite`).exists(), false, "First-run qualification must start empty");
await mkdir("/mnt/onboarding-fixture", { recursive: true });
const fixture = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:size=640x360:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "40", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "/mnt/onboarding-fixture/First local video.mp4"], { stdout: "ignore", stderr: "inherit" });
assert.equal(await fixture.exited, 0);
const checks: string[] = [];
const until: Wait = async (description, predicate, timeout = 15_000) => {
  const end = Date.now() + timeout;
  while (!await predicate()) { assert.ok(Date.now() < end, description); await Bun.sleep(50); }
  checks.push(description); console.log(`PASS ${description}`);
};
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/onboarding-driver.log`), stderr: Bun.file(`${artifacts}/onboarding-native.log`) });
let socket: WebSocket | undefined;
let state: SessionState | undefined;
let session = "", phone: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
const request = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> => {
  const response = await fetch(`http://127.0.0.1:4444${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as { value: any };
  assert.ok(response.ok && !result.value?.error, `WebDriver ${path}: ${result.value?.message ?? response.status}`);
  return result.value;
};
const tv = new UiDriver(request, () => session);
const launch = async () => {
  session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until("native app connects", () => tv.execute("return document.querySelector('[data-app-status] [role=status]')?.textContent === 'Connected'"));
};
const restart = async () => {
  await request(`/session/${session}`, undefined, "DELETE"); session = "";
  await until("native shutdown stops its coordinator", async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } });
  await launch();
};
try {
  await until("native driver starts", async () => { try { return (await fetch("http://127.0.0.1:4444/status")).ok; } catch { return false; } });
  await launch();
  await until("fresh TV shows welcome, QR and separate claim code", () => tv.execute("return document.querySelector('[role=dialog]')?.textContent.includes('Welcome to Couch') && /^[0-9]{10}$/.test(document.querySelector('[data-administrator-code]')?.textContent || '') && !!document.querySelector('[role=dialog] svg title')"));
  const claim = await tv.execute("return document.querySelector('[data-administrator-code]').textContent") as string;
  const code = await tv.execute("return document.querySelector('[data-pairing-code]').textContent") as string;
  phone = await startHttpRemote(origin, code, artifacts, until);
  await until("phone automatically opens claim step", () => phone!.ui.execute("return !!document.querySelector('#administrator-code')"));
  await phone.ui.type("#administrator-code", claim); await phone.ui.button("Claim administrator");
  await until("phone owns setup", () => phone!.ui.execute("return !!document.querySelector('#tv-name:not(:disabled)')"));
  await phone.ui.type("#tv-name", "First-run fixture"); await phone.ui.button("Save name");
  await until("saved name reaches TV", () => tv.execute("return document.querySelector('[data-settings-tv-name]')?.textContent === 'First-run fixture'"));
  await phone.ui.button("Continue to screen");
  await until("TV follows phone's saved screen step", () => tv.execute("return document.querySelector('[role=dialog]')?.textContent.includes('Step 2 of 4')"));
  await restart();
  await until("phone resumes screen after app restart without claiming again", () => phone!.ui.execute("return document.querySelector('[role=dialog]')?.textContent.includes('Step 2 of 4') && !document.querySelector('#administrator-code')"));
  await phone.refresh();
  await until("browser refresh resumes the same screen step", () => phone!.ui.execute("return document.querySelector('[role=dialog]')?.textContent.includes('Step 2 of 4')"));
  await phone.restore();
  await until("existing Display Settings offers a virtual output", () => phone!.ui.execute("return [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label')?.startsWith('Try ') && !button.disabled)"));
  const preview = await phone.ui.execute("return [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith('Try ') && !button.disabled).getAttribute('aria-label')") as string;
  await phone.ui.button(preview);
  await until("native preview offers confirmation", () => phone!.ui.execute("return [...document.querySelectorAll('button')].some(button => button.textContent === 'Keep' && !button.disabled)"));
  await phone.ui.button("Keep");
  await until("display preview is saved", () => phone!.ui.execute("return ![...document.querySelectorAll('button')].some(button => button.textContent === 'Keep') && document.querySelector('[role=dialog]').textContent.includes('Saved')"));
  await assertResponsive(phone.ui, "First-run screen");
  await phone.ui.button("I can see Couch on the right screen");
  await until("existing Sound Settings offers an output", () => phone!.ui.execute("return [...document.querySelectorAll('button')].some(button => button.textContent.startsWith('Use ') && !button.disabled)"));
  const output = await phone.ui.execute("return [...document.querySelectorAll('button')].find(button => button.textContent.startsWith('Use ') && !button.disabled).textContent.slice(4)") as string;
  await phone.ui.button(`Use ${output}`);
  await until("selected output is saved before capturing", () => phone!.ui.execute("return document.querySelector('[role=dialog]')?.textContent.includes('Selected output: ' + arguments[0]) && [...document.querySelectorAll('button')].some(button => button.textContent === 'Test ' + arguments[0] && !button.disabled)", [output]));
  const token = await phone.ui.execute("return localStorage.getItem('couch.remote-token')") as string;
  const sound = await (await fetch(`${origin}/api/sound`, { headers: { Authorization: `Bearer ${token}` } })).json() as SoundState;
  assert.ok(sound.routing?.selectedOutput);
  const pcm = `${artifacts}/onboarding-tone.pcm`;
  const clock = Bun.spawn(["pacat", "--playback", "--raw", `--device=${sound.routing.selectedOutput}`, "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=50", "/dev/zero"], { stdout: "ignore", stderr: Bun.file(`${artifacts}/onboarding-clock.log`) });
  const recorder = Bun.spawn(["parec", `--device=${sound.routing.selectedOutput}.monitor`, "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=50"], { stdout: Bun.file(pcm), stderr: Bun.file(`${artifacts}/onboarding-tone.log`) });
  try {
    await until("virtual monitor is capturing before the tone", () => Bun.file(pcm).size > 0);
    await phone.ui.button(`Test ${output}`);
    await until("audio server confirms the requested test route", () => phone!.ui.execute("return document.querySelector('[role=dialog]')?.textContent.includes('audio server confirms the test stream')"));
    await until("bounded test finishes", () => phone!.ui.execute("return ![...document.querySelectorAll('button')].some(button => button.textContent === 'Stop')"));
  } finally { recorder.kill(); clock.kill(); await Promise.all([recorder.exited, clock.exited]); }
  assert.ok(new Uint8Array(await Bun.file(pcm).arrayBuffer()).some(byte => byte !== 0), "Virtual sink captures non-silent test PCM; audible physical sound is unqualified");
  await phone.ui.button("I heard the test sound");
  await until("optional local and Jellyfin controls are reused", () => phone!.ui.execute("return !!document.querySelector('[aria-label=\"Jellyfin settings\"]') && document.querySelector('[role=dialog]').textContent.includes('folder')"));
  await assertResponsive(phone.ui, "First-run optional sources");
  await phone.ui.button("Finish setup");
  await until("completion opens home on TV and phone", async () => await tv.execute("return !document.querySelector('[role=dialog]')") && await phone!.ui.execute("return !document.querySelector('[role=dialog]')"));
  const NativeSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  socket = new NativeSocket(await remoteSocketUrl(origin, token), { headers: { Origin: origin } });
  socket.addEventListener("message", event => { const message = JSON.parse(String(event.data)); if (message.type === "state") state = message.state; });
  await until("paired observer receives the actual native idle state", () => state?.player.status === "idle");
  await addTVFolder(phone.ui, until, "onboarding-fixture");
  await until("first local source scans through the existing manager", async () => {
    const response = await fetch(origin + "/api/library/items?q=First%20local%20video", { headers: { Authorization: `Bearer ${token}` } });
    return (await response.json() as { items: unknown[] }).items.length === 1;
  });
  await phone.ui.section("Files"); await phone.ui.button("All media", ".library-views");
  await phone.ui.type("#library-query", "First local video"); await phone.ui.button("Search", ".library-search");
  await until("phone offers its first scanned local video", () => phone!.ui.execute("return !!document.querySelector('.library-play-button:not(:disabled)')"));
  const playLabel = await phone.ui.execute("return document.querySelector('.library-play-button').getAttribute('aria-label')") as string;
  await phone.ui.button(playLabel, ".library-items");
  await until("first local item plays on the native TV", () => state?.player.status === "playing" && state.player.position > 0.5 && state.queue.some(entry => entry.id === state!.currentEntryId && entry.source.startsWith("library:")), 30_000);
  await phone.minimize(); await tv.watching();
  await assertNativeVideoPixels(tv.execute, artifacts, "onboarding-first-local-video", [0, 0, 255]);
  await phone.restore(); await phone.ui.controls(); await phone.ui.stopPlayback();
  await until("phone stops its first local item", () => state?.player.status === "idle" && !state.currentEntryId);
  socket.close(); socket = undefined;
  await restart();
  await until("completed restart keeps home and the paired phone", async () => await tv.execute("return !document.querySelector('[role=dialog]')") && await phone!.ui.execute("return !document.querySelector('[role=dialog]') && document.querySelector('[data-app-status] [role=status]')?.textContent === 'Connected'"));
  await phone.restore(); await phone.ui.button("Settings"); await phone.ui.settingsSection("general");
  await until("saved name and ordinary Settings remain available", () => phone!.ui.execute("return document.querySelector('#tv-name')?.value === 'First-run fixture' && !!document.querySelector('[aria-label=\"Settings sections\"]')"));
  await phone.screenshot("onboarding-complete-settings");
  await Bun.write(`${artifacts}/onboarding-acceptance.json`, JSON.stringify({ checks, physicalConfirmation: false, source: "optional source skipped with no Internet access required", audio: "actual test route and non-silent null-sink PCM", localPlayback: "real phone folder registration, scan, native playback pixels and stop", remaining: "Installed target, physical screen and audible sound, machine reboot" }, null, 2));
} catch (error) {
  const report = await phone?.ui.execute("return { step: document.querySelector('[role=dialog]')?.textContent?.slice(0, 240), alerts: [...document.querySelectorAll('[role=alert]')].map(el => el.textContent), buttons: [...document.querySelectorAll('[role=dialog] button')].map(el => ({ text: el.textContent, disabled: el.disabled })) }").catch(() => null);
  await Bun.write(`${artifacts}/onboarding-failure.json`, JSON.stringify({ error: String(error), report, checks }, null, 2));
  throw error;
} finally {
  socket?.close();
  await phone?.close();
  if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill(); await driver.exited;
}
