// Exercise the signed AppImage in a disposable runtime container, including its
// independent Client-only maintenance coordinator and one bundled Couch window.
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const [container, output] = process.argv.slice(2);
assert.ok(container?.startsWith("couch-native-appimage-") && output, "Supply the disposable AppImage fixture and evidence directory");
const evidence = resolve(output);
const selectedHost = "http://127.0.0.1:44101";
const build = JSON.parse(inside("cat", "/evidence/native-build.json")) as { version: string; revision: string; dataFormat: number };
const checks: string[] = [];
let audio: ReturnType<typeof Bun.spawn> | undefined;
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
const application = inside("sh", "-c", "if [ \"${COUCH_APPIMAGE_EXTRACTED:-0}\" = 1 ]; then echo /tmp/appimage/squashfs-root/AppRun; else echo /qualification/Couch.AppImage; fi");
const session = (await driver("/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application } } } })).sessionId as string;
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
  inside("runuser", "-u", "qualifier", "--", "env", "DISPLAY=:99", "sh", "-c", "window=$(xdotool search --onlyvisible --name '^Couch$' | tail -1); xdotool windowmove --sync \"$window\" 0 0");
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
        body:JSON.stringify({build:${JSON.stringify(build)}})
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
  assert.deepEqual(build, JSON.parse(inside("cat", "/evidence/server-build.json")));

  await click('//button[contains(normalize-space(.),"Play on: http://127.0.0.1:44101")]');
  await until("Playback device menu offers this computer", () => element('//button[normalize-space(.)="This computer"]'));
  await click('//button[normalize-space(.)="This computer"]');
  await until("Same AppImage starts its local playback host", async () => {
    const mode = await asyncExecute("return (await window.__TAURI_INTERNALS__.invoke('playback_device')).mode").catch(() => null);
    return mode === "local";
  });
  await until("Local setup offers private sharing", () => element('//button[normalize-space(.)="Keep private"]'));
  await click('//button[normalize-space(.)="Keep private"]');
  await until("Private local setup completes", async () => !await element('//button[normalize-space(.)="Keep private"]'));
  await until("Local navigation loads", () => element('//nav[@aria-label="Main navigation"]//a[@aria-label="Now"]'));
  await click('//nav[@aria-label="Main navigation"]//a[@aria-label="Now"]');
  await until("Local app shows Open file", () => element('//button[normalize-space(.)="Open file"]'));
  const local = await asyncExecute(`
    const connection = await window.__TAURI_INTERNALS__.invoke('connection_info');
    window.__proof = {connection};
    const build = ${JSON.stringify(build)};
    window.__proof.socket = new WebSocket(connection.origin.replace('http','ws') + '/api/ws?token=' + encodeURIComponent(connection.token) + '&build=' + encodeURIComponent(build.version + ':' + build.revision + ':' + build.dataFormat));
    window.__proof.socket.onmessage = event => { const message=JSON.parse(event.data); if(message.type === 'state') window.__proof.state=message.state; };
    return connection;
  `) as { origin: string; token: string };
  assert.match(local.origin, /^http:\/\/127\.0\.0\.1:\d+$/, "Local playback remains on this installation");
  await until("Bundled local player reports ready", () => execute("return window.__proof.state?.player.status === 'idle'"));
  await click('//button[normalize-space(.)="Open file"]');
  await until("Native media chooser opens", async () => inside("runuser", "-u", "qualifier", "--", "env", "DISPLAY=:99", "sh", "-c", "xdotool search --onlyvisible --name 'Open media on this player' | head -1 || true") !== "");
  inside("runuser", "-u", "qualifier", "--", "env", "DISPLAY=:99", "sh", "-c", "window=$(xdotool search --onlyvisible --name 'Open media on this player' | tail -1); xdotool windowactivate --sync \"$window\" key ctrl+l; xdotool type --clearmodifiers --delay 10 /qualification/sample.mp4; xdotool key Return; sleep 0.2; xdotool key Return");
  await until("Native chooser adds the local file through Bun", () => execute("return window.__proof.state?.queue.some(item => item.title === 'sample.mp4' && item.source === 'file:///qualification/sample.mp4')"));
  audio = Bun.spawn(["docker", "exec", "-u", "qualifier", container!, "timeout", "30s", "parec", "--device=qualification.monitor", "--format=s16le", "--rate=48000", "--channels=2"], { stdout: Bun.file(`${evidence}/playback-audio.pcm`), stderr: Bun.file(`${evidence}/playback-audio.log`) });
  await until("Selected PulseAudio monitor produces clocked samples", () => Bun.file(`${evidence}/playback-audio.pcm`).size > 4_800);
  await execute("const item=window.__proof.state.queue.find(item=>item.title==='sample.mp4'); window.__proof.socket.send(JSON.stringify({type:'command',requestId:crypto.randomUUID(),action:{type:'play',entryId:item.id,fromStart:true}})); return true");
  await until("Packaged libmpv reports video and audio playback", () => execute("const p=window.__proof.state?.player; return p?.status === 'playing' && p.position > 1 && p.tracks?.some(t=>t.kind === 'video') && p.tracks?.some(t=>t.kind === 'audio')"));
  inside("sh", "-c", "ps -eo pid,comm,args > /evidence/processes.txt; grep -hE 'lib(mpv|avcodec|avformat|pulse|ass)' /proc/[0-9]*/maps 2>/dev/null > /evidence/media-maps.txt || true");
  inside("runuser", "-u", "qualifier", "--", "env", "DISPLAY=:99", "scrot", "-o", "/evidence/full-playing.png");
  const redPixels = Number(inside("python3", "-c", "from PIL import Image; image=Image.open('/evidence/full-playing.png').convert('RGB'); print(sum(r>190 and g<70 and b<70 for r,g,b in image.getdata()))"));
  assert.ok(redPixels > 20_000, `Native video paints the generated red frame (${redPixels} red pixels)`);
  checks.push("Native video paints generated local file pixels");
  await Bun.sleep(2_000);
  audio.kill(); await audio.exited; audio = undefined;
  const pcm = new Int16Array(await Bun.file(`${evidence}/playback-audio.pcm`).arrayBuffer());
  const nonzeroSamples = pcm.filter(value => value !== 0).length;
  assert.ok(nonzeroSamples > 1_000, `Selected PulseAudio monitor carries decoded audio (${nonzeroSamples} nonzero samples)`);
  checks.push("Selected PulseAudio monitor carries decoded audio");
  await execute("window.__proof.socket.send(JSON.stringify({type:'command',requestId:crypto.randomUUID(),action:{type:'stop'}})); window.__proof.socket.close(); return true");
  await Bun.write(`${evidence}/result.json`, JSON.stringify({ build, checks, redPixels, nonzeroSamples, limits: ["Disposable Debian 12 X11 desktop with software rendering and a PulseAudio null sink", "AppImage extraction avoids Docker's absent FUSE mount", "Physical speaker, normal FUSE launch, installed upgrade and Wayland behavior require separate acceptance"] }, null, 2) + "\n");
} finally {
  if (audio) { audio.kill(); await audio.exited; }
  await request("", undefined, "DELETE").catch(() => {});
  inside("sh", "-c", "pkill -TERM -x couch-server || true");
}
