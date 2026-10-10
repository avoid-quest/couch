import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { helper, startHelpers } from "../src/server/helpers";

const cases: Array<{ name: string; system: string | null; cached: string | null; latest?: string; brokenCache?: boolean; expected: "system" | "cached" }> = [
  { name: "failed update check keeps the newer cached yt-dlp", system: "2025.12.08", cached: "2026.08.19", expected: "cached" },
  { name: "failed update check keeps a newer system yt-dlp", system: "2026.08.19", cached: "2025.12.08", expected: "system" },
  { name: "equal offline versions prefer the system yt-dlp", system: "2026.08.19", cached: "2026.08.19", expected: "system" },
  { name: "system yt-dlp works offline without a cached copy", system: "2026.08.19", cached: null, expected: "system" },
  { name: "cached yt-dlp works offline without a system copy", system: null, cached: "2026.08.19", expected: "cached" },
  { name: "a broken cached yt-dlp falls back to the system copy", system: "2025.12.08", cached: "2026.08.19", brokenCache: true, expected: "system" },
  { name: "successful update check selects the current cached yt-dlp", system: "2025.12.08", cached: "2026.08.19", latest: "2026.08.19", expected: "cached" },
  { name: "system yt-dlp meeting the latest release stays preferred", system: "2026.08.19", cached: "2026.08.20", latest: "2026.08.19", expected: "system" },
];

// Exercise startup selection with real executable probes and a private PATH/cache.
// Only GitHub's release lookup is replaced; no installed Couch data is touched.
for (const scenario of cases) test(scenario.name, { skip: process.platform === "win32", timeout: 5_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-helpers-"));
  const bin = join(directory, "bin"), cache = join(directory, "helpers");
  const system = join(bin, "yt-dlp"), cached = join(cache, "yt-dlp", scenario.cached ?? "unused", "yt-dlp");
  const originalPath = process.env.PATH, originalCertificates = process.env.SSL_CERT_FILE;
  const timers: ReturnType<typeof setInterval>[] = [], set = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => {
    const timer = set(...args); timers.push(timer); return timer;
  });
  t.after(() => {
    for (const timer of timers) clearInterval(timer);
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (originalCertificates === undefined) delete process.env.SSL_CERT_FILE; else process.env.SSL_CERT_FILE = originalCertificates;
    rmSync(directory, { recursive: true, force: true });
  });
  const executable = (path: string, version: string, broken = false) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `#!/bin/sh\n${broken ? "exit 1" : `printf '%s\\n' '${version}'`}\n`, { mode: 0o755 });
  };
  executable(join(bin, "qjs"), "0.17.0");
  executable(join(bin, "ffmpeg"), "ffmpeg version 7.0");
  if (scenario.system) executable(system, scenario.system);
  if (scenario.cached) executable(cached, scenario.cached, scenario.brokenCache);
  process.env.PATH = bin;
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(url);
    if (!scenario.latest) throw new Error("Network unavailable");
    return Response.json({ tag_name: scenario.latest, assets: ["yt-dlp_macos.zip", "yt-dlp_linux.zip", "yt-dlp_linux_aarch64.zip"].map(name => ({
      name, browser_download_url: `https://github.com/yt-dlp/yt-dlp/releases/download/${scenario.latest}/${name}`, digest: `sha256:${"0".repeat(64)}`,
    })) });
  });
  t.mock.method(console, "error", () => {});
  startHelpers(cache);
  const [selected] = await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
  assert.equal(selected, scenario.expected === "cached" ? cached : system);
  assert.deepEqual(requests, ["https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"], "Startup must reuse a runnable local helper without downloading");
});
