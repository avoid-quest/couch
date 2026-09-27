import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SessionState } from "../../src/shared/protocol";
import { remoteSocketUrl } from "./build";

const root = resolve(import.meta.dir, "../..");
const architecture = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
assert.ok(process.platform === "linux" && architecture, "Use the Linux x64/arm64 test environment");
const binary = resolve(process.env.COUCH_SIDECAR ?? join(root, `src-tauri/binaries/couch-server-${architecture}-unknown-linux-gnu`));
const artifacts = resolve(process.env.COUCH_ARTIFACTS ?? join(root, ".artifacts/core-service"));
await mkdir(artifacts, { recursive: true });
await rm(join(artifacts, "result.json"), { force: true });
const version = Bun.spawnSync([binary, "--version"]);
assert.equal(version.exitCode, 0, "Compiled executable reports its identity");
const build = JSON.parse(version.stdout.toString());
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim();
assert.equal(build.revision, revision, "Executable matches the checked-out revision");
assert.equal(build.dirty, false, "Executable was built from clean source");
assert.equal(build.packaged, false, "Standalone source build does not require desktop bundle helpers");
const directory = await mkdtemp(join(tmpdir(), "couch-core-service-"));
const checks: string[] = [];
const recovery = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
let socket: WebSocket | undefined;
let stderr = "";
let readers: Promise<unknown>[] = [];
const wait = async (predicate: () => boolean, message: string) => {
  const deadline = Date.now() + 10_000;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(25);
  assert.ok(predicate(), message);
};
async function start(bootstrap: boolean) {
  stderr = "";
  // Exclude developer/native/proxy configuration: this is an independent fresh Core.
  child = Bun.spawn([binary], { cwd: directory, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: {
    HOME: directory, PATH: "/usr/bin:/bin", COUCH_NATIVE: "0", COUCH_DATA_DIR: directory,
    COUCH_HOST: "127.0.0.1", COUCH_PORT: "0", ...(bootstrap ? { COUCH_ADMIN_RECOVERY_CODE: recovery } : {}),
  } });
  readers = [new Response(child.stdout).text(), (async () => { for await (const chunk of child!.stderr.pipeThrough(new TextDecoderStream())) stderr += chunk; })()];
  await wait(() => /Pairing code: \d{6}/.test(stderr) || child!.exitCode !== null, "Core prints its pairing code");
  assert.equal(child.exitCode, null, "Core stays running without native stdin or helpers");
  const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(stderr)?.[0];
  const code = /Pairing code: (\d{6})/.exec(stderr)?.[1];
  assert.ok(origin && code, "Loopback origin and enrollment code are available to the operator");
  return { origin, code };
}
async function stop() {
  socket?.close(); socket = undefined;
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await wait(() => child!.exitCode !== null, "SIGTERM exits within ten seconds");
  assert.equal(await child.exited, 0, "Core shuts down gracefully");
  await Promise.all(readers);
}
async function request(origin: string, path: string, token?: string, body?: unknown) {
  return fetch(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin,
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000) });
}
try {
  let { origin, code } = await start(true);
  assert.equal((await request(origin, "/api/health")).status, 200);
  const discovery = await (await request(origin, "/api/connection")).json();
  assert.deepEqual(discovery.capabilities, { browserPlayback: true, nativePlayback: false });
  assert.equal(discovery.remoteControlEnabled, true);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  checks.push("fresh private data; loopback Core without native player or optional helpers");
  const html = await request(origin, "/settings/connection");
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type") ?? "", /text\/html/);
  const source = await html.text();
  const asset = /src="(\/assets\/[^" ]+\.js)"/.exec(source)?.[1];
  assert.ok(asset, "Embedded deep link references a built JavaScript asset");
  assert.equal((await request(origin, asset)).status, 200);
  assert.equal((await request(origin, "/sw.js")).status, 200);
  checks.push("embedded deep link, JavaScript and service worker served without dist");
  assert.equal((await request(origin, "/api/controllers/me")).status, 401);
  const pair = await request(origin, "/api/pair", undefined, { code, name: "Core service qualification" });
  assert.equal(pair.status, 200);
  const { token } = await pair.json();
  assert.equal((await (await request(origin, "/api/controllers/me", token)).json()).authority, "controller");
  assert.equal((await request(origin, "/api/controllers/claim", token, { code: recovery })).status, 200);
  assert.equal((await (await request(origin, "/api/controllers/me", token)).json()).authority, "administrator");
  assert.equal((await request(origin, "/api/settings", token, { name: "Independent Core qualification" })).status, 200);
  checks.push("HTTP pairing, separate one-use administrator bootstrap and persistent settings");
  socket = new WebSocket(await remoteSocketUrl(origin, token), { headers: { Origin: origin } });
  let baseline: SessionState | undefined;
  socket.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.type === "state") baseline = message.state; };
  await wait(() => !!baseline, "Authenticated WebSocket receives its session baseline");
  assert.ok(baseline!.sessionId);
  assert.equal(baseline!.targets?.some(target => target.backend === "native"), false);
  checks.push("authenticated session baseline has no invented native target");
  await stop();
  ({ origin, code } = await start(false));
  const restored = await (await request(origin, "/api/controllers/me", token)).json();
  assert.equal(restored.authority, "administrator");
  assert.equal(restored.claimAvailable, false);
  const nextDiscovery = await (await request(origin, "/api/connection")).json();
  assert.equal(nextDiscovery.installationId, discovery.installationId);
  assert.equal(nextDiscovery.name, "Independent Core qualification");
  const second = await (await request(origin, "/api/pair", undefined, { code, name: "Recovery reuse check" })).json();
  assert.equal((await request(origin, "/api/controllers/claim", second.token, { code: recovery })).status, 401);
  checks.push("restart without bootstrap preserves identity, administrator and settings; consumed recovery stays invalid");
  await stop();
  checks.push("both SIGTERM shutdowns exit cleanly");
  await Bun.write(join(artifacts, "result.json"), JSON.stringify({ build, binarySha256: createHash("sha256").update(await Bun.file(binary).arrayBuffer()).digest("hex"), checks, passed: true }, null, 2) + "\n");
  console.log(`Core service qualification passed (${checks.length} checks). Report: ${join(artifacts, "result.json")}`);
} finally {
  socket?.close();
  if (child && child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
  await Promise.allSettled(readers);
  await rm(directory, { recursive: true, force: true });
}
