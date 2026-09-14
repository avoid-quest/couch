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
const diagnostics = createDiagnostics({ databasePath: ${JSON.stringify(join(directory, "state.sqlite"))}, runtime: () => ({ hostname: "localhost", port: 4100, native: true }), native: async () => native, sources: () => [], system: async () => [], helpers: async () => [] });
if (process.argv[2] === "record") diagnostics.log.add("Playback", "password=private-secret https://media.test/private-path?signed=private-query");
const response = await diagnostics.handle(new Request("http://localhost/api/diagnostics/export"), () => ({ authority: "administrator", controller: null, claimAvailable: false }));
console.log(await response.text());`);
    // scripts/build.ts embeds this same build-info JSON into the packaged sidecar.
    const build = await Bun.build({ entrypoints: [entry], outdir: join(directory, "built"), target: "bun", define: { "COUCH_BUILD_INFO": JSON.stringify(JSON.stringify(metadata)) } });
    expect(build.success).toBe(true);
    const child = Bun.spawn([process.execPath, build.outputs[0]!.path, "record"], { stdout: "pipe", stderr: "pipe" });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(errors).toBe(""); expect(code).toBe(0);
    const report = JSON.parse(output);
    expect(report.build).toEqual(metadata);
    expect(report.native.build).toEqual(metadata);
    expect(report.recent[0].build).toEqual(metadata);
    expect(output).not.toContain("private-secret");
    expect(output).not.toContain("media.test");
    const nextMetadata = { ...metadata, version: "0.1.0+build.50", revision: "abcdef0123456789abcdef0123456789abcdef0123" };
    const nextBuild = await Bun.build({ entrypoints: [entry], outdir: join(directory, "next"), target: "bun", define: { "COUCH_BUILD_INFO": JSON.stringify(JSON.stringify(nextMetadata)) } });
    expect(nextBuild.success).toBe(true);
    const restarted = Bun.spawn([process.execPath, nextBuild.outputs[0]!.path], { stdout: "pipe", stderr: "pipe" });
    const [nextOutput, nextErrors, nextCode] = await Promise.all([new Response(restarted.stdout).text(), new Response(restarted.stderr).text(), restarted.exited]);
    expect(nextErrors).toBe(""); expect(nextCode).toBe(0);
    const nextReport = JSON.parse(nextOutput);
    expect(nextReport.build).toEqual(nextMetadata);
    expect(nextReport.recent).toEqual(report.recent);
    expect(nextReport.sessionId).not.toBe(report.sessionId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
