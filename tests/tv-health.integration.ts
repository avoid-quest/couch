import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const checker = resolve("packaging/tv/check-health.js");
const options = { skip: process.platform !== "linux", timeout: 10_000 };

async function check({ wrongData = false, unhealthy = false, remote = false, linkedData = false, mediaFirst = undefined as boolean | undefined, mediaResponse = "missing" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "couch-tv-health-"));
  const database = join(directory, "couch.sqlite");
  await writeFile(database, "");
  await writeFile(join(directory, "other.sqlite"), "");
  await writeFile(join(directory, "operating-mode.json"), JSON.stringify({ mode: remote ? "remote" : "local" }));
  if (linkedData) await symlink(directory, `${directory}-link`);
  // Electron's runtime environment need not be visible in /proc/<pid>/environ.
  // The child owns a real database descriptor and HTTP socket, as Core does.
  const child = `
    import { openSync, readFileSync } from 'node:fs';
    import { createServer } from 'node:http';
    process.env.COUCH_DATA_DIR = ${JSON.stringify(directory)};
    process.env.COUCH_HOST_TOKEN = 'a'.repeat(64);
    openSync(${JSON.stringify(wrongData ? join(directory, "other.sqlite") : database)}, 'r');
    const health = (request, response) => {
      if (request.url !== '/api/health' || request.headers.authorization) { response.writeHead(401).end(); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: ${!unhealthy} }));
    };
    const servers = await Promise.all(Array.from({ length: ${mediaFirst === undefined ? 1 : 2} }, async () => {
      const server = createServer();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      return server;
    }));
    // /proc order is independent of bind order and port number. Assign the
    // handlers only after reading the kernel's order, to cover both reliably.
    const ports = readFileSync('/proc/self/net/tcp', 'utf8').trim().split('\\n').slice(1)
      .map(line => line.trim().split(/\\s+/)).filter(fields => fields[3] === '0A')
      .map(fields => parseInt(fields[1].split(':')[1], 16));
    servers.sort((a, b) => ports.indexOf(a.address().port) - ports.indexOf(b.address().port));
    servers[${mediaFirst === true ? 1 : 0}].on('request', health);
    ${mediaFirst === undefined ? "" : `servers[${mediaFirst ? 0 : 1}].on('request', (_request, response) => {
      if (${JSON.stringify(mediaResponse)} === 'hanging') return;
      if (${JSON.stringify(mediaResponse)} === 'invalid') { response.end('media bytes'); return; }
      response.writeHead(404).end();
    });`}
    console.log('ready');
  `;
  const parent = remote ? "console.log('ready'); setInterval(() => {}, 1000);" : `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(child)}, '--', 'node.mojom.NodeService'], { env: { ELECTRON_RUN_AS_NODE: '1' } });
    child.stdout.once('data', () => console.log('ready'));
    process.on('SIGTERM', () => { child.kill(); child.once('exit', () => process.exit()); });
  `;
  const app = spawn(process.execPath, ["--input-type=module", "-e", parent], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "inherit"] });
  try {
    await once(app.stdout!, "data");
    return await promisify(execFile)(process.execPath, [checker, String(app.pid), linkedData ? `${directory}-link` : directory], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 5000 });
  } finally {
    const exited = once(app, "exit");
    app.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
    if (linkedData) await rm(`${directory}-link`);
  }
}

test("a healthy Core passes when its runtime environment is absent from proc", options, async () => {
  const result = JSON.parse((await check()).stdout);
  assert.equal(result.mode, "local");
  assert.ok(result.corePid > 0);
});

test("the check follows an administrator's data-directory symlink", options, async () => {
  assert.equal(JSON.parse((await check({ linkedData: true })).stdout).mode, "local");
});

test("a healthy HTTP server using another database fails", options, async () => {
  await assert.rejects(check({ wrongData: true }), /Core is using another data directory/);
});

test("a Core that owns the correct database but fails health is rejected", options, async () => {
  await assert.rejects(check({ unhealthy: true }), /Core is unhealthy/);
});

for (const mediaFirst of [true, false]) {
  test(`a healthy Core passes with its media listener ${mediaFirst ? "first" : "last"}`, options, async () => {
    assert.equal(JSON.parse((await check({ mediaFirst })).stdout).mode, "local");
  });

  test(`an unhealthy Core fails with its media listener ${mediaFirst ? "first" : "last"}`, options, async () => {
    await assert.rejects(check({ mediaFirst, unhealthy: true }), /Core is unhealthy/);
  });
}

for (const mediaResponse of ["invalid", "hanging"]) test(`${mediaResponse} media responses do not hide a healthy Core`, options, async () => {
  assert.equal(JSON.parse((await check({ mediaFirst: true, mediaResponse })).stdout).mode, "local");
});

test("Another Couch passes without a local Core", options, async () => {
  const result = JSON.parse((await check({ remote: true })).stdout);
  assert.equal(result.mode, "remote");
  assert.equal(result.corePid, undefined);
});
