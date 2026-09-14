import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, link, mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { ToolHealth, UbuntuPackageStatus } from "../shared/tool-health";
import { runDiagnosticCommand } from "./diagnostics-system";
import { createToolHealth } from "./tool-health";

const administrator: ControllerIdentity = { authority: "administrator", controller: null, claimAvailable: false };
const roots: string[] = [];
afterEach(async () => { setSystemTime(); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const request = () => new Request("http://localhost/api/tools");
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "couch-tool-health-")); roots.push(directory);
  const bin = join(directory, "bin"); await mkdir(bin);
  const helpers: Record<string, { version: string; sha256: string }> = {};
  for (const [name, version, output] of [["yt-dlp", "2026.08.19", "2026.08.19"], ["deno", "2.9.6", "deno 2.9.6\nv8 1.2.3"], ["ffprobe", "7.1.5-0+deb13u1", "ffprobe version 7.1.5-0+deb13u1"]]) {
    const content = `#!/bin/sh\nprintf '%s\\n' '${output}'\n`;
    await writeFile(join(directory, name!), content, { mode: 0o755 });
    helpers[name!] = { version: version!, sha256: createHash("sha256").update(content).digest("hex") };
  }
  await writeFile(join(bin, "ffprobe"), "#!/bin/sh\necho 'ffprobe version 7.1.5-0+deb13u1'\n", { mode: 0o755 });
  const options = { packaged: true, helpers, directory, env: { PATH: bin, COUCH_YT_DLP: join(directory, "yt-dlp"), COUCH_DENO: join(directory, "deno"), COUCH_HOST_TOKEN: "private-host", SECRET: "private-value" } };
  return { options, directory, bin, report: async (overrides: Partial<Parameters<typeof createToolHealth>[0]> = {}) => await (await createToolHealth({ ...options, ...overrides }).handle(request(), () => administrator)).json() as ToolHealth };
}

test("verifies release bytes before fixed local version commands, with no inherited credentials or source requests", async () => {
  const f = await fixture();
  const calls: string[] = [];
  const report = await f.report({ command: async (path, args, env) => {
    expect(env).toEqual({ PATH: f.bin, LANG: "C", LC_ALL: "C" });
    calls.push(path);
    expect(args).toEqual(path.endsWith("yt-dlp") ? ["--ignore-config", "--no-plugin-dirs", "--version"] : path.endsWith("deno") ? ["--version"] : ["-version"]);
    return runDiagnosticCommand(path, args, env);
  } });
  expect(calls).toHaveLength(3);
  expect(report.tools.map(tool => [tool.expectedVersion, tool.installed.version, tool.installed.status, tool.effective.source])).toEqual([["2026.08.19", "2026.08.19", "ready", "package"], ["2.9.6", "2.9.6", "ready", "package"]]);
  expect(report.ffprobe).toEqual({ status: "ready", version: "7.1.5-0+deb13u1", error: null });
  for (const secret of [f.directory, "private-host", "private-value"]) expect(JSON.stringify(report)).not.toContain(secret);
});

test("packaged builds reject missing helpers despite a working environment override", async () => {
  const f = await fixture(), override = join(f.bin, "yt-dlp");
  await writeFile(override, "#!/bin/sh\necho 2026.01.01\n", { mode: 0o755 });
  await rm(join(f.directory, "yt-dlp"));
  await writeFile(join(f.directory, "deno"), "corrupted token=private");
  const calls: string[] = [];
  const report = await f.report({ env: { ...f.options.env, COUCH_YT_DLP: override }, command: async (path, args, env) => { calls.push(path); return runDiagnosticCommand(path, args, env); } });
  expect(report.tools[0]!.installed.status).toBe("missing");
  expect(report.tools[0]!.effective.status).toBe("missing");
  expect(report.tools[1]!.installed.status).toBe("corrupt");
  expect(report.tools[1]!.effective.status).toBe("corrupt");
  expect(calls).not.toContain(join(f.directory, "deno"));
  expect(JSON.stringify(report)).not.toContain("private");
});

test("PATH fallback and aliases cannot hide or execute damaged package tools", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "deno"), "corrupt");
  await symlink(join(f.directory, "deno"), join(f.bin, "yt-dlp"));
  await symlink(join(f.directory, "deno"), join(f.bin, "deno"));
  const calls: string[] = [];
  const report = await f.report({ env: { PATH: f.bin }, command: async (path, args, env) => { calls.push(path); return runDiagnosticCommand(path, args, env); } });
  expect(report.tools[0]!.installed.status).toBe("ready");
  expect(report.tools[0]!.effective.source).toBe("package");
  expect(report.tools[0]!.effective.status).toBe("ready");
  expect(report.tools[1]!.effective.status).toBe("corrupt");
  expect(calls).toEqual([join(f.directory, "yt-dlp"), join(f.directory, "ffprobe")]);
});

test("hard links to corrupt package tools are blocked for overrides, cross-tool aliases and ffprobe", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "deno"), "corrupt");
  await link(join(f.directory, "deno"), join(f.bin, "deno"));
  await link(join(f.directory, "deno"), join(f.bin, "yt-dlp"));
  await rm(join(f.bin, "ffprobe")); await link(join(f.directory, "deno"), join(f.bin, "ffprobe"));
  const calls: string[] = [];
  const report = await f.report({ env: { PATH: f.bin, COUCH_DENO: join(f.bin, "deno") }, command: async (path, args, env) => { calls.push(path); return runDiagnosticCommand(path, args, env); } });
  expect(report.tools[0]!.effective.status).toBe("ready");
  expect(report.tools[1]!.effective.status).toBe("corrupt");
  expect(report.tools[1]!.effective.source).toBe("package");
  expect(report.ffprobe.status).toBe("ready");
  expect(calls).toEqual([join(f.directory, "yt-dlp"), join(f.directory, "ffprobe")]);
});

test("packaged helpers ignore bare environment overrides and PATH", async () => {
  const f = await fixture();
  const report = await f.report({ env: { PATH: f.bin, COUCH_YT_DLP: "absent-extractor", COUCH_FFPROBE: "/missing/ffprobe" } });
  expect(report.tools.every(tool => tool.effective.status === "ready" && tool.effective.source === "package")).toBe(true);
  expect(report.ffprobe.status).toBe("ready");
  await rm(join(f.directory, "ffprobe"));
  expect((await f.report()).ffprobe.status).toBe("missing");
});

test("symlink replacement, oversized archives and unreadable version results do not become success", async () => {
  const f = await fixture();
  await rm(join(f.directory, "yt-dlp")); await symlink(join(f.directory, "deno"), join(f.directory, "yt-dlp"));
  let report = await f.report(); expect(report.tools[0]!.installed.status).toBe("corrupt"); expect(report.tools[1]!.effective.status).toBe("ready");
  await rm(join(f.directory, "yt-dlp"));
  const large = await open(join(f.directory, "yt-dlp"), "w"); await large.truncate(256 * 1024 * 1024 + 1); await large.close();
  report = await f.report(); expect(report.tools[0]!.installed.status).toBe("unknown");
  report = await f.report({ command: async () => { throw new Error(`secret at ${f.directory}`); } });
  expect(report.tools[1]!.installed.status).toBe("error");
  expect(report.ffprobe.status).toBe("error");
  expect(JSON.stringify(report)).not.toContain(f.directory);
  expect(JSON.stringify(report)).not.toContain("secret");
});

test("version mismatch and absent executable permission differ from a missing runtime dependency", async () => {
  const f = await fixture();
  f.options.helpers.deno!.version = "2.9.5";
  await chmod(join(f.directory, "yt-dlp"), 0o644); await rm(join(f.directory, "ffprobe"));
  const report = await f.report();
  expect(report.tools[0]!.installed.status).toBe("error");
  expect(report.tools[1]!.installed).toEqual({ status: "corrupt", version: "2.9.6", error: "The verified tool reports a different version from this release." });
  expect(report.ffprobe.status).toBe("missing");
});

test("unpackaged or absent release metadata never invents verified package health", async () => {
  const f = await fixture();
  for (const options of [{ packaged: false }, { helpers: null }, { helpers: { "yt-dlp": { version: "private / path", sha256: "bad" } } }]) {
    const report = await f.report(options);
    expect(report.tools.map(tool => tool.installed.status)).toEqual(["unknown", "unknown"]);
    expect(report.tools.map(tool => tool.effective.status)).toEqual(["unknown", "unknown"]);
    expect(report.ffprobe.status).toBe("packaged" in options ? "ready" : "unknown");
    expect(JSON.stringify(report)).not.toContain("private");
  }
});

test("only administrators can trigger fixed checks and no request can choose paths or commands", async () => {
  const f = await fixture(); let calls = 0;
  const health = createToolHealth({ ...f.options, command: async () => { calls++; return "2026.08.19"; } });
  for (const identity of [null, { ...administrator, authority: "controller" as const }]) expect((await health.handle(request(), () => identity)).status).toBe(403);
  expect((await health.handle(new Request(request(), { method: "POST", body: '{"command":"private"}' }), () => administrator)).status).toBe(405);
  expect((await health.handle(new Request("http://localhost/api/tools?path=/private"), () => administrator)).status).toBe(400);
  expect((await health.handle(new Request("http://localhost/api/tools/private"), () => administrator)).status).toBe(404);
  expect(calls).toBe(0);
});

test("concurrent checks share work and cached reads do not repeat helper execution", async () => {
  const f = await fixture(); let calls = 0;
  const health = createToolHealth({ ...f.options, command: async (path, args, env) => { calls++; return runDiagnosticCommand(path, args, env); } });
  const responses = await Promise.all([health.handle(request(), () => administrator), health.handle(request(), () => administrator)]);
  expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
  expect(responses[0]!.headers.get("Cache-Control")).toBe("no-store");
  expect(calls).toBe(3);
  await health.handle(request(), () => administrator); expect(calls).toBe(3);
});

test("administrator revocation and shutdown take effect while local probes are pending", async () => {
  const f = await fixture(), gate = Promise.withResolvers<string>();
  let identity: ControllerIdentity | null = administrator;
  const health = createToolHealth({ ...f.options, command: () => gate.promise });
  const response = health.handle(request(), () => identity);
  identity = null; gate.resolve("2026.08.19");
  expect((await response).status).toBe(403);
  health.close();
  expect((await health.handle(request(), () => administrator)).status).toBe(503);
});

test("a timed-out check stays the only unfinished job even after cache expiry", async () => {
  const f = await fixture(), gate = Promise.withResolvers<string>(); let calls = 0;
  const health = createToolHealth({ ...f.options, command: () => { calls++; return gate.promise; } });
  const report = await (await health.handle(request(), () => administrator)).json() as ToolHealth;
  expect(report.tools.every(tool => tool.installed.status === "unknown")).toBe(true);
  expect(calls).toBe(1);
  setSystemTime(new Date(Date.now() + 11_000));
  const next = health.handle(request(), () => administrator);
  expect(calls).toBe(1);
  let stopped = false;
  const closing = health.close().then(() => stopped = true);
  await closing;
  expect(stopped).toBe(true);
  gate.resolve("2026.08.19");
  expect((await next).status).toBe(503);
}, 15_000);

test("repair verification ignores the health cache and effective overrides, and requires bounded package smoke", async () => {
  const f = await fixture(), calls: { path: string; args: string[] }[] = [];
  const health = createToolHealth({ ...f.options, env: { ...f.options.env, COUCH_DENO: "/custom/unchanged-deno" }, command: async (path, args, env) => {
    calls.push({ path, args });
    if (args.includes("--version")) return path.endsWith("yt-dlp") ? "2026.08.19" : "deno 2.9.6";
    if (args.includes("--get-url")) return args.at(-1)!;
    if (args[0] === "eval") return "42";
    if (args[0] === "-version") return "ffprobe version 7.1.5-0+deb13u1";
    expect(env).toEqual({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" });
    return "pcm_s16le";
  } });
  try {
    await health.verify(true);
    expect(calls.map(call => call.path)).not.toContain("/custom/unchanged-deno");
    expect(calls.some(call => call.path === join(f.directory, "ffprobe") && call.args.includes("-show_entries"))).toBe(true);
    await health.handle(request(), () => administrator);
    await writeFile(join(f.directory, "deno"), "corrupt after cached health");
    calls.length = 0;
    await expect(health.verify(false)).rejects.toThrow("fresh hash/version");
    expect(calls.some(call => call.path === join(f.directory, "deno"))).toBe(false);
  } finally { await health.close(); }
  const valid = await fixture();
  const smokeFailure = createToolHealth({ ...valid.options, command: async (path, args) => args.includes("--version") ? path.endsWith("yt-dlp") ? "2026.08.19" : "deno 2.9.6" : args.includes("--get-url") ? args.at(-1)! : args.includes("-version") ? "ffprobe version 7.1.5-0+deb13u1" : "wrong" });
  await expect(smokeFailure.verify(false)).rejects.toThrow("runtime smoke");
  await smokeFailure.close();
});

test("Ubuntu status is a bounded fixed read, remains separate and never accepts package selectors", async () => {
  const f = await fixture(); let calls = 0;
  const health = createToolHealth({ ...f.options, ubuntuStatus: async () => {
    calls++;
    return { available: 4, security: 2, broken: 0, indexUpdatedAt: null, checkedAt: new Date().toISOString(), error: null };
  } });
  try {
    const url = "http://localhost/api/tools/ubuntu";
    expect((await health.handle(new Request(url), () => null)).status).toBe(403);
    expect((await health.handle(new Request(url + "?package=couch"), () => administrator)).status).toBe(400);
    expect((await health.handle(new Request(url, { method: "POST" }), () => administrator)).status).toBe(405);
    expect(calls).toBe(0);
    expect(await (await health.handle(new Request(url), () => administrator)).json()).toMatchObject({ available: 4, security: 2, broken: 0, indexUpdatedAt: null });
    await health.handle(new Request(url), () => administrator); expect(calls).toBe(1);
  } finally { await health.close(); }
});

test("shutdown during Ubuntu inspection reports unavailable rather than revoked access", async () => {
  const f = await fixture(), gate = Promise.withResolvers<UbuntuPackageStatus>(), started = Promise.withResolvers<void>();
  const health = createToolHealth({ ...f.options, ubuntuStatus: () => { started.resolve(); return gate.promise; } });
  const response = health.handle(new Request("http://localhost/api/tools/ubuntu"), () => administrator);
  await started.promise;
  const closing = health.close();
  gate.resolve({ available: 0, security: 0, broken: 0, indexUpdatedAt: null, checkedAt: new Date().toISOString(), error: null });
  expect((await response).status).toBe(503);
  await closing;
});

test("package inventory gets its fixed larger budget while version probes keep their short deadline", async () => {
  const args = ["-e", "setTimeout(() => console.log('completed'), 1800)"];
  await expect(runDiagnosticCommand(process.execPath, args, {})).rejects.toThrow("time / 4 KiB limit");
  expect(await runDiagnosticCommand(process.execPath, args, {}, 5_000)).toBe("completed");
});
