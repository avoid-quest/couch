// Exercise the signed AppImage in a disposable runtime container, including its
// independent Client-only maintenance coordinator and one bundled Couch window.
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const [container, output] = process.argv.slice(2);
assert.ok(container?.startsWith("couch-native-appimage-") && output, "Supply the disposable AppImage fixture and evidence directory");
const evidence = resolve(output);
const selectedHost = "http://127.0.0.1:44101";
const checks: string[] = [];
function inside(...args: string[]) {
  const child = Bun.spawnSync(["docker", "exec", container!, ...args]);
  assert.equal(child.exitCode, 0, `${args[0]} failed: ${child.stderr.toString()}`);
  return child.stdout.toString().trim();
}
async function driver(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const args = ["curl", "--fail", "--silent", "--show-error", "--max-time", "30", "-X", method, "-H", "Content-Type: application/json"];
  if (body !== undefined) args.push("--data-binary", JSON.stringify(body));
  const response = JSON.parse(inside(...args, `http://127.0.0.1:44444${path}`));
  assert.ok(!response.value?.error, JSON.stringify(response.value));
  return response.value;
}
async function until(description: string, check: () => Promise<unknown>, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    assert.ok(Date.now() < deadline, `${description} timed out`);
    await Bun.sleep(250);
  }
  checks.push(description);
  console.log(`PASS ${description}`);
}
const session = (await driver("/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "/qualification/Couch.AppImage" } } } })).sessionId as string;
const request = (path: string, body?: unknown, method?: string) => driver(`/session/${session}${path}`, body, method);
const execute = (script: string) => request("/execute/sync", { script, args: [] });
const asyncExecute = (script: string) => request("/execute/async", { script: `const done = arguments[arguments.length - 1]; (async () => { ${script} })().then(done, error => done({error:String(error)}));`, args: [] });
async function element(xpath: string) {
  const found = await request("/elements", { using: "xpath", value: xpath }).catch(() => []) as Array<Record<string, string>>;
  for (const item of found) {
    const id = item["element-6066-11e4-a52e-4f735466cecf"];
    if (id && await request(`/element/${id}/displayed`).catch(() => false)) return id;
  }
  return null;
}
async function click(xpath: string) {
  const id = await element(xpath);
  assert.ok(id, `Visible control missing: ${xpath}`);
  await request(`/element/${id}/click`, {});
}
try {
  await until("Clean AppImage opens playback-device choice", () => element('//*[self::h1 or self::h2][normalize-space(.)="Where do you want to play?"]'));
  const bundledUrl = await request("/url") as string;
  assert.match(bundledUrl, /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)(?:\/|$)/, "The app loads its bundled frontend");
  await Bun.write(`${evidence}/first-launch.png`, Buffer.from(await request("/screenshot"), "base64"));
  await click('//button[normalize-space(.)="Another Couch"]');
  const address = await element('//label[normalize-space(.)="Couch address"]/following::input[1]');
  assert.ok(address, "Remote address field is labelled");
  await request(`/element/${address}/value`, { text: "127.0.0.1:44101" });
  await click('//button[normalize-space(.)="Connect"]');
  await until("AppImage starts its own maintenance coordinator", async () => {
    const result = await asyncExecute(`
      const connection = await window.__TAURI_INTERNALS__.invoke('connection_info');
      const response = await fetch(connection.origin + '/api/maintenance/frontend', {
        method:'POST', headers:{Authorization:'Bearer ' + connection.token, 'Content-Type':'application/json'},
        body:JSON.stringify({build:${JSON.stringify(JSON.parse(inside("cat", "/evidence/native-build.json")))}})
      });
      return response.status === 204;
    `).catch(() => false);
    return result === true;
  });
  assert.equal(inside("sh", "-c", "pgrep -x couch-server | wc -l"), "2", "One selected host and one private maintenance coordinator must run");
  await until("Selected host appears in the bundled window", () => element('//button[contains(normalize-space(.),"Play on: http://127.0.0.1:44101")]'));
  assert.equal((await request("/window/handles") as string[]).length, 1, "The desktop has one WebDriver window");
  assert.equal(await request("/url"), bundledUrl, "Selecting a host keeps the bundled frontend");
  assert.equal(inside("sh", "-c", "xdotool search --onlyvisible --name '^Couch remote$' || true"), "", "No second remote OS window opens");
  await until("Shared window requests a pairing code", () => element('//label[normalize-space(.)="Pairing code"]/following::input[1]'));
  const code = inside("cat", "/evidence/host.log").match(/Pairing code:\s*(\d{6})/)?.[1];
  assert.ok(code, "The selected host supplies a pairing code");
  const name = await element('//label[normalize-space(.)="Device name"]/following::input[1]');
  assert.ok(name, "The shared shell labels the device name");
  await request(`/element/${name}/value`, { text: "AppImage client" });
  const pairing = await element('//label[normalize-space(.)="Pairing code"]/following::input[1]');
  assert.ok(pairing, "Pairing code field is labelled");
  await request(`/element/${pairing}/value`, { text: code });
  await click('//button[normalize-space(.)="Connect"]');
  await until("Paired Client-only window loads host navigation", () => element('//nav[@aria-label="Main navigation"]'));
  const authority = await asyncExecute(`
    const pairing = JSON.parse(localStorage.getItem('couch.pairing:${selectedHost}') || '{}');
    const response = await fetch('${selectedHost}/api/controllers/me', {headers:{Authorization:'Bearer ' + pairing.token}});
    return response.ok ? (await response.json()).authority : response.status;
  `);
  assert.equal(authority, "administrator", "The host, not the AppImage, grants this remote's role");
  assert.equal(await execute("return window.__COUCH_NATIVE_HOST__ === true"), true, "The shared bundled shell retains native identity");
  const localGrant = await asyncExecute("try { await window.__TAURI_INTERNALS__.invoke('choose_media'); return true; } catch { return false; }");
  assert.equal(localGrant, false, "Another Couch cannot use local media commands");
  assert.equal(await request("/url"), bundledUrl, "Pairing keeps the sole bundled window");
  assert.equal((await request("/window/handles") as string[]).length, 1, "Pairing opens no second window");
  assert.deepEqual(JSON.parse(inside("cat", "/evidence/native-build.json")), JSON.parse(inside("cat", "/evidence/server-build.json")));
  await Bun.write(`${evidence}/result.json`, JSON.stringify({ build: JSON.parse(inside("cat", "/evidence/native-build.json")), checks, limits: ["Disposable Debian 13 X11 desktop with software rendering and null audio", "AppImage extraction avoids Docker's absent FUSE mount", "Installed upgrade and Wayland behavior require separate acceptance"] }, null, 2) + "\n");
} finally {
  await request("", undefined, "DELETE").catch(() => {});
  inside("sh", "-c", "pkill -TERM -x couch-server || true");
}
