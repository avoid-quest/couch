import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("compiled diagnostic exports retain packaged version, commit and target metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-diagnostic-build-"));
  const metadata = { version: "0.1.0", revision: "0123456789abcdef0123456789abcdef01234567", target: "x86_64-unknown-linux-gnu", packaged: true };
  try {
    const entry = join(directory, "fixture.ts");
    await writeFile(entry, `import { createDiagnostics } from ${JSON.stringify(resolve(import.meta.dir, "../src/server/diagnostics.ts"))};
const native = ${JSON.stringify({ build: metadata, facts: [] })};
const diagnostics = createDiagnostics({ databasePath: ":memory:", runtime: () => ({ hostname: "localhost", port: 4100, native: true }), native: async () => native, sources: () => [], system: async () => [], helpers: async () => [] });
const response = await diagnostics.handle(new Request("http://localhost/api/diagnostics/export"), () => ({ authority: "administrator", controller: null, claimAvailable: false }));
console.log(await response.text());`);
    // scripts/build.ts embeds this same build-info JSON into the packaged sidecar.
    const build = await Bun.build({ entrypoints: [entry], outdir: join(directory, "built"), target: "bun", define: { "process.env.COUCH_BUILD_INFO": JSON.stringify(JSON.stringify(metadata)) } });
    expect(build.success).toBe(true);
    const child = Bun.spawn([process.execPath, build.outputs[0]!.path], { stdout: "pipe", stderr: "pipe" });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(errors).toBe(""); expect(code).toBe(0);
    const report = JSON.parse(output);
    expect(report.build).toEqual(metadata);
    expect(report.native.build).toEqual(metadata);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
