import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs/promises";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

test("buildRelay reads real runtime and module licenses across Go layouts", async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-relay-licenses-")), dependency = join(directory, "dependency");
  const execFile = cp.execFile, read = fs.readFile;
  const reads: string[] = [];
  let readFailure: unknown;
  fs.readFile = (async (...args: Parameters<typeof read>) => {
    reads.push(String(args[0]));
    try { return await read(...args); } catch (error) { readFailure = error; throw error; }
  }) as typeof fs.readFile;
  t.after(async () => { cp.execFile = execFile; fs.readFile = read; syncBuiltinESMExports(); await rm(directory, { recursive: true, force: true }); });
  await mkdir(dependency);
  await writeFile(join(dependency, "LICENSE"), "Real dependency license\n");
  let goroot = "";
  const exec = promisify(cp.execFile), calls: string[][] = [];
  cp.execFile = ((...args: Parameters<typeof execFile>) => execFile(...args)) as typeof execFile;
  Object.defineProperty(cp.execFile, promisify.custom, { value: async (file: string, args: string[], options: cp.ExecFileOptions) => {
    if (file !== "go") return exec(file, args, options);
    calls.push(args);
    assert.equal(options.env?.CGO_ENABLED, "0");
    assert.equal(options.env?.GOTOOLCHAIN, "local");
    assert.ok(["build", "list", "env"].includes(args[0]!));
    const module = `example.test/dependency|v1.2.3|${dependency}\n`;
    const output = args[0] === "env" ? `${goroot}\n` : args[0] === "list" ? module.repeat(2) : "";
    return { stdout: output, stderr: "" };
  } });
  syncBuiltinESMExports();
  // Import after installing the Go command stub: buildRelay promisifies execFile at module load.
  // Keep the actual filesystem and buildRelay implementation, including dependency checks.
  const { buildRelay } = await import(pathToFileURL(resolve("scripts/build-relay.ts")).href);
  for (const scenario of [
    { name: "upstream", layout: "go", direct: "Upstream license\n", expected: "Upstream license\n" },
    { name: "homebrew", layout: "libexec", parent: "Homebrew license\n", expected: "Homebrew license\n" },
    { name: "precedence", layout: "libexec", direct: "Preferred license\n", parent: "Unused parent\n", expected: "Preferred license\n" },
    { name: "unrelated layout", layout: "other", parent: "Must not use\n", error: "ENOENT", missing: "direct" },
    { name: "runtime read error", layout: "libexec", directDirectory: true, parent: "Must not mask error\n", error: "EISDIR" },
    { name: "missing fallback", layout: "libexec", error: "ENOENT", missing: "parent" },
    { name: "fallback read error", layout: "libexec", parentDirectory: true, error: "EISDIR" },
  ]) await t.test(scenario.name, async () => {
    const prefix = join(directory, scenario.name), destination = join(prefix, "output");
    goroot = join(prefix, scenario.layout);
    await mkdir(goroot, { recursive: true });
    if (scenario.direct) await writeFile(join(goroot, "LICENSE"), scenario.direct);
    if (scenario.parent) await writeFile(join(prefix, "LICENSE"), scenario.parent);
    if (scenario.directDirectory) await mkdir(join(goroot, "LICENSE"));
    if (scenario.parentDirectory) await mkdir(join(prefix, "LICENSE"));
    reads.length = 0; readFailure = undefined;
    if (scenario.error) await assert.rejects(buildRelay("linux", "x64", destination), (error: NodeJS.ErrnoException) => {
      assert.equal(error.code, scenario.error);
      assert.equal(error, readFailure, "propagate the actual filesystem error unchanged");
      assert.deepEqual(reads, [join(goroot, "LICENSE"), ...scenario.missing === "parent" || scenario.parentDirectory ? [join(prefix, "LICENSE")] : []], "attempt exactly the allowed license paths, without masking a read error");
      return true;
    });
    else {
      await buildRelay("linux", "x64", destination);
      const notices = await readFile(join(destination, "THIRD-PARTY-NOTICES.txt"), "utf8");
      assert.equal(notices, `Go runtime\n\n${scenario.expected}\n\n--------------------\n\nexample.test/dependency v1.2.3 — LICENSE\n\nReal dependency license\n`);
    }
  });
  await t.test("a linked dependency without a license still fails", async () => {
    goroot = join(directory, "upstream", "go");
    await rm(join(dependency, "LICENSE"));
    await assert.rejects(buildRelay("linux", "x64", join(directory, "missing-module-license")), /Missing license for bundled relay dependency example.test\/dependency/);
  });
  assert.equal(calls.filter(args => args[0] === "build").length, 8);
  assert.equal(calls.filter(args => args[0] === "list").length, 8);
  assert.equal(calls.filter(args => args[0] === "env").length, 8);
});
