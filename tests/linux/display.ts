import { seedConfiguredFixture } from "./configured-fixture";
seedConfiguredFixture();
import { strict as assert } from "node:assert";
const origin = "http://127.0.0.1:4100";
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file("/artifacts/journey-driver.log"), stderr: Bun.file("/artifacts/journey-native.log") });
let session = "";
let token = "";
async function wd(path: string, body?: unknown, method = body ? "POST" : "GET") {
 const response = await fetch(`http://127.0.0.1:4444${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
 const result: any = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result.value;
}
async function api(path: string, body?: unknown) {
 const response = await fetch(`${origin}${path}`, { method: body ? "POST" : "GET", headers: { origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
 const result: any = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
}
async function until(fn: () => Promise<boolean>, seconds = 20) {
 const deadline = Date.now() + seconds * 1000;
 while (!await fn()) { assert.ok(Date.now() < deadline, "Timed out"); await Bun.sleep(250); }
}
const evidence: any[] = [];
try {
 await until(async () => { try { await wd("/status"); return true; } catch { return false; } });
 session = (await wd("/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
 let code = "";
 await until(async () => { code = await wd(`/session/${session}/execute/sync`, { script: "return document.querySelector('.pair-shortcut strong')?.textContent || ''", args: [] }); return !!code; });
 token = (await api("/api/pair", { code, name: "Display qualification" })).token;
 await api("/api/controllers/claim", { code: "1234567890abcdef1234567890abcdef" });
 let state = await api("/api/display"); evidence.push({ step: "inventory", state });
 const outputs = state.outputs.filter((output: any) => output.connected && output.width);
 assert.equal(outputs.length, 2, "Two independently enabled dummy outputs required");
 const previous = state.current;
 const target = outputs.find((output: any) => output.id !== previous);
 assert.ok(target);
 state = await api("/api/display/preview", { output: target.id });
 await until(async () => (await api("/api/display")).current === target.id);
 evidence.push({ step: "moved", state: await api("/api/display") });
 // No controller requests while the native expiry runs.
 await Bun.sleep(21_500);
 state = await api("/api/display"); assert.equal(state.preview, null); assert.equal(state.current, previous); evidence.push({ step: "native-timeout-restored", state });
 state = await api("/api/display/preview", { output: target.id });
 await until(async () => (await api("/api/display")).current === target.id);
 state = await api("/api/display/confirm", { token: state.preview.token });
 assert.equal(state.saved, target.id); assert.equal(state.current, target.id); evidence.push({ step: "confirmed", state });
 assert.equal(await Bun.file(`${process.env.COUCH_DATA_DIR}/display-output`).text(), target.id);
 const geometry = await new Response(Bun.spawn(["xdotool", "getactivewindow", "getwindowgeometry", "--shell"], { stdout: "pipe" }).stdout).text();
 assert.ok(geometry.includes(`X=${target.x}\n`) && geometry.includes(`WIDTH=${target.width}\n`), geometry);
 state = await api("/api/display/preview", { output: previous });
 await until(async () => (await api("/api/display")).current === previous);
 state = await api("/api/display/cancel", { token: state.preview.token });
 await until(async () => (await api("/api/display")).current === target.id);
 evidence.push({ step: "cancel-restored", state: await api("/api/display") });
 await wd(`/session/${session}`, undefined, "DELETE"); session = "";
 session = (await wd("/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
 await until(async () => { try { return (await api("/api/display")).current === target.id; } catch { return false; } });
 evidence.push({ step: "native-restart-retains-selection-and-administrator", state: await api("/api/display") });
 assert.equal(await Bun.spawn(["xrandr", "--output", target.name, "--off"]).exited, 0);
 await until(async () => (await api("/api/display")).current === previous);
 state = await api("/api/display"); assert.equal(state.saved, target.id);
 evidence.push({ step: "disabled-target-fallback-retains-saved-choice", state });
 assert.equal(await Bun.spawn(["xrandr", "--output", target.name, "--mode", "1920x1080", "--right-of", outputs.find((output: any) => output.id === previous).name]).exited, 0);
 await until(async () => (await api("/api/display")).current === target.id);
 evidence.push({ step: "reenabled-target-restored", state: await api("/api/display") });
 console.log("PASS real Tauri two-output preview, timeout without controller requests, confirm, cancel, restart, disabled-output fallback and reenable");
} finally {
 await Bun.write("/artifacts/journey.json", JSON.stringify(evidence, null, 2));
 if (session) await wd(`/session/${session}`, undefined, "DELETE").catch(() => {});
 driver.kill(); await driver.exited;
}
