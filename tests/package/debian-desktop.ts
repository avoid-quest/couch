// Exercise the installed application through the official Tauri WebDriver in a disposable container.
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const [container, output] = process.argv.slice(2);
assert.ok(container?.startsWith("couch-native-deb-") && output, "Supply the disposable native Debian fixture container and evidence directory");
const evidence = resolve(output);
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
const checks: string[] = [];
async function until(description: string, check: () => Promise<unknown>, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    assert.ok(Date.now() < deadline, `${description} timed out`);
    await Bun.sleep(250);
  }
  checks.push(description);
  console.log(`PASS ${description}`);
}
const native = (await driver("/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "/usr/bin/couch" } } } })).sessionId;
const execute = (script: string) => driver(`/session/${native}/execute/sync`, { script, args: [] });
const asyncExecute = (script: string) => driver(`/session/${native}/execute/async`, { script: `const done = arguments[arguments.length - 1]; (async () => { ${script} })().then(done, error => done({error:String(error)}));`, args: [] });
try {
  await until("Fresh native installation opens its playback-device choice", () => execute("return document.body.innerText.includes('Where do you want to play?')"));
  await Bun.write(`${evidence}/first-launch.png`, Buffer.from(await driver(`/session/${native}/screenshot`), "base64"));
  await execute("Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'This computer').click(); return true");
  await until("Choosing this computer starts the packaged backend", async () => inside("sh", "-c", "pgrep -x couch-server >/dev/null && echo ready || true") === "ready");
  const connected = await asyncExecute(`
    const connection = await window.__TAURI_INTERNALS__.invoke('connection_info');
    window.__proof = {connection};
    window.__proof.api = async (path, body) => {
      const response = await fetch(connection.origin + path, {method: body === undefined ? 'GET' : 'POST', headers: {'Authorization':'Bearer ' + connection.token, 'Content-Type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
      if (!response.ok) throw Error(path + ': ' + response.status);
      return response.json();
    };
    return {build: await window.__proof.api('/api/build')};
  `);
  assert.ok(connected.build?.packaged && connected.build.revision && !connected.error);
  assert.deepEqual(connected.build, JSON.parse(inside("cat", "/evidence/native-build.json")));
  await until("Local setup offers an explicit sharing choice", () => execute("return Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Keep private')"));
  await execute("Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Keep private').click(); return true");
  await until("Local setup completes without enabling sharing", () => execute("return !document.body.innerText.includes('Allow remote control?')"));
  const tools = inside("runuser", "-u", "qualifier", "--", "sh", "-c", "pid=$(pgrep -n -x couch-server); tr '\\0' '\\n' < /proc/$pid/environ | grep '^COUCH_BUNDLED_TOOLS=' ");
  assert.equal(tools, "COUCH_BUNDLED_TOOLS=/usr/lib/Couch/tools");
  checks.push("Native launcher, backend and packaged helper paths agree");
  assert.ok(!(await asyncExecute(`
    const sources = await window.__proof.api('/api/library/sources', {path:'/home/qualifier/Videos'});
    await window.__proof.api('/api/library/sources/' + sources.sources[0].id + '/scan', {});
    return true;
  `))?.error);
  await until("Bundled ffprobe scans a local video", async () => (await asyncExecute("return (await window.__proof.api('/api/library/items')).items.some(item => item.duration > 10)") ) === true);
  const socket = await asyncExecute(`
    const {connection} = window.__proof;
    const build = await window.__proof.api('/api/build');
    const ws = new WebSocket(connection.origin.replace('http','ws') + '/api/ws?token=' + encodeURIComponent(connection.token) + '&build=' + encodeURIComponent(build.version + ':' + build.revision + ':' + build.dataFormat));
    window.__proof.socket = ws;
    ws.onmessage = event => { const message=JSON.parse(event.data); if(message.type === 'state') window.__proof.state=message.state; };
    return true;
  `);
  assert.equal(socket, true);
  await until("Native player reports ready", () => execute("return window.__proof.state?.player.status === 'idle'"));
  assert.equal(await asyncExecute(`
    const item = (await window.__proof.api('/api/library/items')).items[0];
    window.__proof.socket.send(JSON.stringify({type:'command', requestId:crypto.randomUUID(), action:{type:'enqueueLibrary',itemId:item.id,entryId:crypto.randomUUID(),playNow:true}}));
    return true;
  `), true);
  await until("Debian libmpv plays video and audio", () => execute("const p=window.__proof.state?.player; return p?.status === 'playing' && p.position > 1 && p.tracks?.some(t=>t.kind === 'video') && p.tracks?.some(t=>t.kind === 'audio')"));
  await execute("Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Show playback')?.click(); return true");
  inside("runuser", "-u", "qualifier", "--", "env", "DISPLAY=:99", "ffmpeg", "-v", "error", "-y", "-f", "x11grab", "-video_size", "1280x720", "-i", ":99", "-frames:v", "1", "/evidence/playing.png");
  await execute("window.__proof.socket.send(JSON.stringify({type:'command',requestId:crypto.randomUUID(),action:{type:'stop'}})); window.__proof.socket.close(); return true");
  await driver(`/session/${native}`, undefined, "DELETE");
  inside("sh", "-c", "pkill -TERM -x couch || true; pkill -TERM -x couch-server || true");
  inside("runuser", "-u", "qualifier", "--", "env", "HOME=/home/qualifier", "DISPLAY=:99", "XDG_SESSION_TYPE=x11", "GDK_BACKEND=x11", "COUCH_DATA_DIR=/home/qualifier/couch-data", "COUCH_PORT=44100", "LIBGL_ALWAYS_SOFTWARE=1", "COUCH_BASIC_RENDERING=1", "WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1", "sh", "-c", "gtk-launch Couch > /evidence/desktop-launch.log 2>&1");
  await until("The installed desktop entry relaunches Couch", async () => inside("runuser", "-u", "qualifier", "--", "env", "DISPLAY=:99", "sh", "-c", "xdotool search --onlyvisible --class '^Couch$' 2>/dev/null || true").length > 0);
  inside("sh", "-c", "pkill -TERM -x couch || true; pkill -TERM -x couch-server || true");
  inside("apt-get", "remove", "--yes", "couch");
  inside("sh", "-c", "test ! -e /usr/bin/couch && test ! -e /usr/bin/couch-server && test ! -e /usr/share/applications/Couch.desktop && test ! -e /usr/lib/Couch/tools/deno && sha256sum -c /evidence/user-data.sha256 && test -s /home/qualifier/couch-data/couch.sqlite");
  checks.push("APT removal deletes package files and preserves user data");
  await Bun.write(`${evidence}/result.json`, JSON.stringify({ build: connected.build, checks, limits: ["Disposable Debian X11 desktop with software rendering and null audio sink", "WebKit sandbox disabled for container instrumentation", "No physical GPU, audible output, booted login session, native update or AppImage migration acceptance"] }, null, 2) + "\n");
} catch (error) {
  await driver(`/session/${native}`, undefined, "DELETE").catch(() => {});
  throw error;
}
