import { strict as assert } from "node:assert";
import { UiDriver, assertResponsive, startHttpRemote, type Wait } from "./ui";
import type { SoundState } from "../../src/shared/sound";

// Run on an empty COUCH_DATA_DIR with the joined native build, virtual X11
// outputs and a Pulse-compatible null sink. These are not physical confirmations.
const origin = "http://127.0.0.1:4100", artifacts = "/artifacts";
assert.ok(process.env.COUCH_DATA_DIR, "Set an isolated first-run data directory");
assert.equal(await Bun.file(`${process.env.COUCH_DATA_DIR}/couch.sqlite`).exists(), false, "First-run qualification must start empty");
const checks: string[] = [];
const until: Wait = async (description, predicate, timeout = 15_000) => {
  const end = Date.now() + timeout;
  while (!await predicate()) { assert.ok(Date.now() < end, description); await Bun.sleep(50); }
  checks.push(description); console.log(`PASS ${description}`);
};
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/onboarding-driver.log`), stderr: Bun.file(`${artifacts}/onboarding-native.log`) });
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
  await until("native app connects", () => tv.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
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
  await until("existing Display Settings offers a virtual output", () => phone!.ui.execute("return [...document.querySelectorAll('button')].some(button => button.textContent.startsWith('Preview on ') && !button.disabled)"));
  const preview = await phone.ui.execute("return [...document.querySelectorAll('button')].find(button => button.textContent.startsWith('Preview on ') && !button.disabled).textContent") as string;
  await phone.ui.button(preview); await phone.ui.button("Keep this screen");
  await until("display preview is saved", () => phone!.ui.execute("return ![...document.querySelectorAll('button')].some(button => button.textContent === 'Keep this screen') && document.querySelector('[role=dialog]').textContent.includes('Saved')"));
  await assertResponsive(phone.ui, "First-run screen");
  await phone.ui.button("I can see Couch on the right screen");
  await until("existing Sound Settings offers an output", () => phone!.ui.execute("return [...document.querySelectorAll('button')].some(button => button.textContent.startsWith('Use ') && !button.disabled)"));
  const output = await phone.ui.execute("return [...document.querySelectorAll('button')].find(button => button.textContent.startsWith('Use ') && !button.disabled).textContent.slice(4)") as string;
  await phone.ui.button(`Use ${output}`);
  const token = await phone.ui.execute("return localStorage.getItem('couch.remote-token')") as string;
  const sound = await (await fetch(`${origin}/api/sound`, { headers: { Authorization: `Bearer ${token}` } })).json() as SoundState;
  assert.ok(sound.routing?.selectedOutput);
  const pcm = `${artifacts}/onboarding-tone.pcm`;
  const recorder = Bun.spawn(["parec", `--device=${sound.routing.selectedOutput}.monitor`, "--format=s16le", "--rate=48000", "--channels=2"], { stdout: Bun.file(pcm), stderr: Bun.file(`${artifacts}/onboarding-tone.log`) });
  try {
    await phone.ui.button(`Test ${output}`);
    await until("audio server confirms the requested test route", () => phone!.ui.execute("return document.querySelector('[role=dialog]')?.textContent.includes('audio server confirms the test stream')"));
    await until("bounded test finishes", () => phone!.ui.execute("return ![...document.querySelectorAll('button')].some(button => button.textContent === 'Stop sound test')"));
  } finally { recorder.kill(); await recorder.exited; }
  assert.ok(new Uint8Array(await Bun.file(pcm).arrayBuffer()).some(byte => byte !== 0), "Virtual sink captures non-silent test PCM; audible physical sound is unqualified");
  await phone.ui.button("I heard the test sound");
  await until("optional local and Jellyfin controls are reused", () => phone!.ui.execute("return !!document.querySelector('[aria-label=\"Jellyfin settings\"]') && document.querySelector('[role=dialog]').textContent.includes('folder')"));
  await assertResponsive(phone.ui, "First-run optional sources");
  await phone.ui.button("Finish setup");
  await until("completion opens home on TV and phone", async () => await tv.execute("return !document.querySelector('[role=dialog]')") && await phone!.ui.execute("return !document.querySelector('[role=dialog]')"));
  await restart();
  await until("completed restart keeps home and the paired phone", async () => await tv.execute("return !document.querySelector('[role=dialog]')") && await phone!.ui.execute("return !document.querySelector('[role=dialog]') && document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  await phone.restore(); await phone.ui.button("Settings");
  await until("saved name and ordinary Settings remain available", () => phone!.ui.execute("return document.querySelector('#tv-name')?.value === 'First-run fixture' && !!document.querySelector('[aria-label=\"Settings sections\"]')"));
  await phone.screenshot("onboarding-complete-settings");
  await Bun.write(`${artifacts}/onboarding-acceptance.json`, JSON.stringify({ checks, physicalConfirmation: false, source: "optional source skipped with no Internet access required", audio: "actual test route and non-silent null-sink PCM", remaining: "Installed target, physical screen and audible sound, reboot and first local item playback" }, null, 2));
} finally {
  await phone?.close();
  if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill(); await driver.exited;
}
