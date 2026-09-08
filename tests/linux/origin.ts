import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import { buildKey } from "../../src/shared/build";
import type { QueueEntry } from "../../src/shared/protocol";

// Playwright is a pinned, read-only test input, not an application dependency.
const { chromium } = await import("/inputs/playwright-core/index.mjs");
const origin = "https://couch-origin.test:8443";
const publicDir = "/artifacts/public", privateDir = "/artifacts/private";
const caddy = "/tmp/origin-tools/caddy";
const executablePath = "/tmp/origin-tools/chrome-linux/headless_shell";
const checks: { name: string; at: string; detail?: unknown }[] = [];
const browserErrors: unknown[] = [];
const pass = (name: string, detail?: unknown) => { checks.push({ name, at: new Date().toISOString(), detail }); console.log(`PASS ${name}`); };
let server: ReturnType<typeof Bun.spawn> | undefined, proxy: ReturnType<typeof Bun.spawn> | undefined, browser: any;
let serverAttempt = 0, proxyAttempt = 0;
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function until(name: string, predicate: () => Promise<unknown>, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { if (await predicate()) return; await Bun.sleep(100); }
  throw new Error(`Timed out: ${name}`);
}
async function command(args: string[]) {
  const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  assert.equal(code, 0, `${args[0]} failed: ${stderr}`);
  return stdout.trim();
}
async function stop(process: ReturnType<typeof Bun.spawn> | undefined) {
  if (!process || process.exitCode !== null) return;
  process.kill("SIGTERM");
  const timer = setTimeout(() => { if (process.exitCode === null) process.kill("SIGKILL"); }, 5000);
  try { await process.exited; } finally { clearTimeout(timer); }
}
async function startServer() {
  serverAttempt++;
  server = Bun.spawn(["/work/src-tauri/binaries/couch-server-aarch64-unknown-linux-gnu"], { cwd: "/work", env: { ...process.env, NODE_ENV: "production", COUCH_NATIVE: "0", COUCH_HOST: "127.0.0.1", COUCH_PORT: "4100", COUCH_ADVERTISE_URLS: origin, COUCH_DATA_DIR: `${privateDir}/couch` }, stdout: Bun.file(`${privateDir}/server-${serverAttempt}.out`), stderr: Bun.file(`${privateDir}/server-${serverAttempt}.log`) });
  await until("Couch ready", async () => { try { return (await fetch("http://127.0.0.1:4100/api/health", { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } });
  const log = await readFile(`${privateDir}/server-${serverAttempt}.log`, "utf8");
  const code = /Pairing code: (\d{6})/.exec(log)?.[1];
  assert.ok(code, "Actual coordinator emitted its pairing code");
  return code;
}
async function startProxy() {
  proxy = Bun.spawn([caddy, "run", "--config", `${privateDir}/Caddyfile`, "--adapter", "caddyfile"], { env: { ...process.env, XDG_DATA_HOME: `${privateDir}/caddy-data`, XDG_CONFIG_HOME: `${privateDir}/caddy-config` }, stdout: Bun.file(`${privateDir}/caddy-${++proxyAttempt}.out`), stderr: Bun.file(`${privateDir}/caddy-${proxyAttempt}.log`) });
  await until("Caddy certificate ready", async () => Bun.file(`${privateDir}/caddy-data/caddy/pki/authorities/local/root.crt`).exists());
}
function tls(path: string, headers: Record<string, string> = {}, method = "GET", body?: string): Promise<{ status: number; body: string; headers: any }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({ hostname: "127.0.0.1", port: 8443, servername: "couch-origin.test", path, method, ca: rootCa, rejectUnauthorized: true, headers: { Host: "couch-origin.test:8443", ...headers } }, response => {
      let body = ""; response.on("data", chunk => body += chunk); response.on("end", () => resolve({ status: response.statusCode!, body, headers: response.headers }));
    });
    request.setTimeout(5000, () => request.destroy(new Error("TLS request timed out")));
    request.on("error", reject); if (body) request.write(body); request.end();
  });
}
let rootCa: Buffer;
function launch(home: string) {
  return chromium.launch({ executablePath, headless: true, env: { ...process.env, HOME: home }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP couch-origin.test 127.0.0.1", "--no-proxy-server"] });
}
async function connected(page: any) {
  await page.waitForFunction(() => document.querySelector(".header-status [role=status]")?.textContent === "Player unavailable", undefined, { timeout: 15000 });
}
async function pair(page: any, code: string) {
  const response = await page.goto(origin);
  assert.equal(response?.status(), 200, "Trusted browser receives the actual frontend");
  await page.locator("#pairing-code").fill(code);
  await page.locator(".pair-form button").click();
  await connected(page);
  const token = await page.evaluate(() => localStorage.getItem("couch.remote-token"));
  assert.ok(token, "The real pairing form retained its controller token");
  return token as string;
}
async function current(page: any, token: string) {
  return page.evaluate(async token => { const result = await fetch("/api/controllers/me", { headers: { Authorization: `Bearer ${token}` } }); return { status: result.status, body: await result.json() }; }, token);
}
async function send(page: any, token: string, action: unknown) {
  const buildResponse = await tls("/api/build", { Origin: origin, Authorization: `Bearer ${token}` });
  assert.equal(buildResponse.status, 200);
  const build = buildKey(JSON.parse(buildResponse.body));
  return page.evaluate(({ token, action, build }) => new Promise((resolve, reject) => {
    const url = new URL("/api/ws", location.origin.replace("https:", "wss:"));
    url.searchParams.set("token", token);
    if (build) url.searchParams.set("build", build);
    const socket = new WebSocket(url);
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { socket.close(); reject(new Error("WSS command timeout")); }, 5000);
    socket.onerror = () => { clearTimeout(timer); reject(new Error("WSS command failed")); };
    socket.onopen = () => socket.send(JSON.stringify({ type: "command", requestId, action }));
    socket.onmessage = event => { const message = JSON.parse(event.data); if (message.type === "result" && message.requestId === requestId) { clearTimeout(timer); socket.close(); resolve(message); } };
  }), { token, action, build });
}
try {
  await mkdir(`${privateDir}/untrusted`, { recursive: true });
  await mkdir(`${privateDir}/trusted/.local/share/pki/nssdb`, { recursive: true });
  await writeFile(`${privateDir}/Caddyfile`, `{
  admin off
  skip_install_trust
  http_port 8080
  https_port 8443
  default_bind 127.0.0.1
  grace_period 1s
}
https://couch-origin.test:8443 {
  tls internal
  reverse_proxy 127.0.0.1:4100
}
`);
  const code = await startServer();
  await startProxy();
  rootCa = await readFile(`${privateDir}/caddy-data/caddy/pki/authorities/local/root.crt`);
  await until("TLS upstream ready", async () => { try { return (await tls("/api/connection")).status === 200; } catch { return false; } });
  const details = JSON.parse((await tls("/api/connection")).body);
  assert.ok(details.urls.includes(origin));
  pass("Actual Caddy TLS serves the configured HTTPS origin", details);

  browser = await launch(`${privateDir}/untrusted`);
  let rejected = false;
  try { await (await browser.newPage()).goto(origin, { timeout: 10000 }); } catch (error) { rejected = /ERR_CERT_AUTHORITY_INVALID/.test(String(error)); }
  assert.ok(rejected, "Fresh browser must reject the untrusted local CA");
  pass("Fresh Chromium rejects the disposable CA before trust enrollment");
  await browser.close(); browser = undefined;
  const nss = `sql:${privateDir}/trusted/.local/share/pki/nssdb`;
  await command(["certutil", "-N", "--empty-password", "-d", nss]);
  await command(["certutil", "-A", "-d", nss, "-n", "Couch disposable qualification", "-t", "C,,", "-i", `${privateDir}/caddy-data/caddy/pki/authorities/local/root.crt`]);
  await writeFile(`${publicDir}/nss-trust.txt`, await command(["certutil", "-L", "-d", nss]));
  browser = await launch(`${privateDir}/trusted`);
  const first = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const second = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const sockets: string[] = [];
  for (const page of [first, second]) {
    page.on("websocket", socket => sockets.push(new URL(socket.url()).protocol));
    page.on("pageerror", error => browserErrors.push({ error: String(error) }));
    page.on("requestfailed", request => browserErrors.push({ failedPath: new URL(request.url()).pathname, failure: request.failure() }));
    page.on("response", response => { if (response.status() >= 400) browserErrors.push({ failedPath: new URL(response.url()).pathname, status: response.status() }); });
  }
  const token = await pair(first, code), token2 = await pair(second, code);
  assert.notEqual(token, token2);
  assert.equal(await first.evaluate(() => window.isSecureContext), true);
  const controller = await current(first, token), controller2 = await current(second, token2);
  assert.equal(controller.status, 200); assert.equal(controller2.status, 200);
  assert.equal((await first.evaluate(async () => (await fetch("/api/controllers/me")).status)), 401);
  pass("Two real Chromium remotes pair over trusted HTTPS and authenticated WSS", { protocols: sockets, first: controller.body, second: controller2.body });
  const entry: QueueEntry = { id: "origin-proof", title: "Origin qualification", source: "https://example.invalid/never-played.mp4" };
  assert.equal((await send(first, token, { type: "enqueue", entry })).ok, true);
  await second.getByText("Origin qualification", { exact: true }).waitFor();
  assert.ok(sockets.length >= 3 && sockets.every(protocol => protocol === "wss:"));
  pass("Authenticated WSS queue command broadcasts to the other HTTPS browser");
  await first.screenshot({ path: `${publicDir}/phone.png` });
  for (const bad of ["http://couch-origin.test:8443", "https://untrusted.example", "null"]) {
    assert.equal((await tls("/api/connection", { Origin: bad })).status, 403);
    assert.equal((await tls(`/api/ws?token=${encodeURIComponent(token)}`, { Origin: bad, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" })).status, 403);
  }
  const wrongHost = await tls("/api/connection", { Host: "untrusted.example", Origin: origin, "X-Forwarded-Host": "couch-origin.test:8443", "X-Forwarded-Proto": "https" });
  assert.ok(!wrongHost.body.includes(origin), "Wrong Host must not disclose the Couch connection response");
  const directWrongHost = await fetch("http://127.0.0.1:4100/api/connection", { headers: { Host: "untrusted.example", Origin: origin, "X-Forwarded-Host": "couch-origin.test:8443", "X-Forwarded-Proto": "https" } });
  assert.equal(directWrongHost.status, 403, "Couch independently rejects an unrecognized Host despite forged forwarded headers");
  assert.deepEqual(await directWrongHost.json(), { error: "Unrecognized host or origin." });
  assert.equal((await tls("/api/controllers/me", { Origin: origin, Authorization: "Bearer invalid" })).status, 401);
  assert.equal((await tls("/api/ws?token=invalid", { Origin: origin, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" })).status, 401);
  pass("Actual TLS proxy rejects wrong Origin, scheme and authentication; wrong Host does not return Couch connection details", { wrongHostStatus: wrongHost.status, wrongHostBody: wrongHost.body, directWrongHostStatus: directWrongHost.status });

  await stop(proxy); proxy = undefined;
  await until("Browser observes stopped proxy", async () => (await first.locator(".header-status").textContent())?.includes("Player unavailable") === false);
  await startProxy(); await connected(first); await connected(second);
  assert.equal(hash(await readFile(`${privateDir}/caddy-data/caddy/pki/authorities/local/root.crt`)), hash(rootCa));
  assert.deepEqual(await current(first, token), controller);
  pass("Caddy restart retains its CA and both browsers reconnect without pairing");

  await stop(server); server = undefined;
  await until("Browser observes stopped Couch", async () => (await first.locator(".header-status").textContent())?.includes("Player unavailable") === false);
  await startServer(); await connected(first); await connected(second);
  assert.deepEqual(await current(first, token), controller);
  assert.deepEqual(await current(second, token2), controller2);
  await first.getByText("Origin qualification", { exact: true }).waitFor();
  assert.equal((await send(second, token2, { type: "remove", entryId: "origin-proof" })).ok, true);
  await first.getByText("Origin qualification", { exact: true }).waitFor({ state: "hidden" });
  pass("Couch restart retains controllers and queue; authenticated WSS still changes shared state");
  await first.reload(); await connected(first);
  pass("Trusted HTTPS browser refresh retains its pairing");
  await writeFile(`${publicDir}/result.json`, JSON.stringify({ ok: true, source: "d77af244cf6d1f6aab872e2fee0a11897284815f", caddy: await command([caddy, "version"]), chromium: await browser.version(), bun: Bun.version, rootCaSha256: hash(rootCa), checks, limits: "Disposable Linux source coordinator only. No native player, packaged target, LAN DNS, physical phone trust enrollment or elapsed certificate renewal qualification." }, null, 2));
} catch (error) {
  const pages = browser?.contexts().flatMap(context => context.pages()) ?? [];
  for (const [index, page] of pages.entries()) {
    await page.screenshot({ path: `${privateDir}/failure-browser-${index}.png` }).catch(() => {});
    await writeFile(`${privateDir}/failure-browser-${index}.json`, JSON.stringify(await page.evaluate(() => ({ title: document.title, text: document.body.innerText, html: document.documentElement.outerHTML })).catch(() => null)));
  }
  await writeFile(`${publicDir}/browser-errors.json`, JSON.stringify(browserErrors, null, 2));
  await writeFile(`${publicDir}/failure.json`, JSON.stringify({ error: String(error), checks }, null, 2));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  await stop(proxy); await stop(server);
}
