/** Run on disposable Ubuntu after test-update-feed.py; this never installs packages. */
import assert from "node:assert/strict";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createUpdateFeed } from "../src/server/update-feed";

const fixture = resolve(process.argv[2]!);
const output = await mkdtemp(join(tmpdir(), "couch-verified-staging-"));
let fault = "";
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  const file = Bun.file(join(fixture, "feed", path));
  if (!await file.exists()) return new Response(null, { status: 404 });
  if (fault === "offline") return new Response(null, { status: 503 });
  if (fault === "signature" && path.endsWith("InRelease")) return new Response((await file.text()).replace("Origin: Couch", "Origin: Forged"));
  if (fault === "expired" && path.endsWith("InRelease")) return new Response(Bun.file(join(fixture, "expired.InRelease")));
  if (fault === "manifest" && path.endsWith("release.json")) return new Response(`${await file.text()} `);
  if (fault === "package" && path.endsWith(".deb")) return new Response("bad archive");
  return new Response(file);
} });
try {
  const feed = createUpdateFeed(output, "0.1.0+build.1.1", {
    // The runner may be arm64; these are deliberately amd64 archive fixtures, never executed.
    compatible: async () => true,
    enrollment: async () => ({ feed: `http://127.0.0.1:${server.port}/`, key: await readFile(join(fixture, "fixture.asc"), "utf8") }),
  });
  const signal = () => AbortSignal.timeout(30_000);
  const candidate = await feed.check("preview", signal());
  assert.equal(candidate?.summary.version, "0.1.0+build.2.1");
  await feed.stage(candidate!, signal());
  assert.deepEqual((await readdir(join(output, candidate!.summary.id))).sort(), ["InRelease", "Packages", "release.json", ...candidate!.manifest.packages.map(p => p.filename)].sort());
  for (fault of ["signature", "expired", "manifest", "offline"]) await assert.rejects(feed.check("preview", signal()));
  fault = "package";
  await assert.rejects(feed.stage(candidate!, signal()));
  assert.deepEqual(await readdir(output), [candidate!.summary.id]);
  console.log(JSON.stringify({ checks: ["real gpgv armored enrollment", "signed metadata and archive hashes", "real dpkg ordering and contents", "no Installed-Size field", "bad signature", "signed expiry", "manifest tamper", "offline feed", "package tamper preserves previous ready directory"], candidate: candidate!.summary.version, productionArchitectureQualified: false }));
} finally { await server.stop(true); await rm(output, { recursive: true, force: true }); }
