// Runs Core's integration tests on Node, the runtime Core ships with.
// bun run test:integration [name ...]   (names without .integration.ts; all when omitted)
import { $ } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.COUCH_TEST_FFMPEG && !Bun.which("ffmpeg")) {
  console.error("Integration tests need FFmpeg: put it on PATH or set COUCH_TEST_FFMPEG.");
  process.exit(1);
}

const names = process.argv.slice(2);
const files = names.length
  ? names.map(name => `tests/${name}.integration.ts`)
  : [...new Bun.Glob("tests/*.integration.ts").scanSync()];
const out = "build/integration";
rmSync(out, { recursive: true, force: true });

await $`bun run build`; // Core's audio worker
await $`bun build ${files} --target=node --outdir=${out} --entry-naming=[name].mjs`.quiet();

const data = mkdtempSync(join(tmpdir(), "couch-integration-"));
try {
  const result = await $`node --test ${`${out}/*.mjs`}`
    .env({ ...process.env, COUCH_DATA_DIR: data, COUCH_PORT: "0" })
    .nothrow();
  process.exitCode = result.exitCode;
} finally {
  rmSync(data, { recursive: true, force: true });
}
