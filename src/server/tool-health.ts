import { readAptPackageStatus } from "./apt-package-status";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { ManagedToolHealth, ToolHealth, ToolObservation, AptPackageStatus } from "../shared/tool-health";
import { probeMediaHelper, runDiagnosticCommand } from "./diagnostics-system";

const cacheSeconds = 10;
const checkMilliseconds = 10_000;
const maximumBytes = 256 * 1024 * 1024;
const managedTools = [{ name: "yt-dlp", file: "yt-dlp", variable: "COUCH_YT_DLP" }, { name: "Deno", file: "deno", variable: "COUCH_DENO" }] as const;
type Options = { packaged: boolean; helpers: unknown; env?: NodeJS.ProcessEnv; directory?: string; command?: typeof runDiagnosticCommand; packageStatus?: typeof readAptPackageStatus };
const observation = (status: ToolObservation["status"], error: string | null, version: string | null = null): ToolObservation => ({ status, version, error });
const unknown = () => observation("unknown", "The local check did not finish. Try again after the TV responds.");

function expectedHelper(helpers: unknown, name: string): { version: string; sha256: string } | null {
  const value = helpers && typeof helpers === "object" ? (helpers as Record<string, unknown>)[name] : null;
  if (!value || typeof value !== "object") return null;
  const { version, sha256 } = value as Record<string, unknown>;
  return typeof version === "string" && /^[\w.+:~-]{1,100}$/.test(version) && typeof sha256 === "string" && /^[a-f\d]{64}$/.test(sha256) ? { version, sha256 } : null;
}

async function verifyPackage(path: string, expected: string, signal: AbortSignal): Promise<ToolObservation | null> {
  // Nonblocking/no-follow open rejects links and special files without reading
  // an unbounded target. Hash in small chunks so playback work can keep running.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile()) return observation("corrupt", "The package tool is not a regular file.");
    if (before.size > maximumBytes) return observation("unknown", "The package tool exceeds the 256 MiB check limit.");
    const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    while (true) {
      signal.throwIfAborted();
      const read = await file.read(buffer, 0, Math.min(buffer.length, maximumBytes - bytes + 1), bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > maximumBytes) return observation("unknown", "The package tool exceeds the 256 MiB check limit.");
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    signal.throwIfAborted();
    const after = await lstat(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== bytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return observation("unknown", "The package tool changed during its check. Try again.");
    if (hash.digest("hex") !== expected) return observation("corrupt", "The package tool does not match this Couch release. It was not executed.");
    if (!(before.mode & 0o111)) return observation("error", "The verified package tool is not executable.");
    return null;
  } finally { await file.close(); }
}

export function createToolHealth(options: Options) {
  const env = options.env ?? process.env;
  // The native owner supplies its actual bundle location independently of effective tool overrides.
  const directory = options.directory ?? env.COUCH_BUNDLED_TOOLS ?? "/usr/lib/Couch/tools";
  const shutdown = new AbortController();
  let cached: ToolHealth | null = null;
  let pending: Promise<ToolHealth> | null = null;

  let systemCached: AptPackageStatus | null = null, systemPending: Promise<AptPackageStatus> | null = null;
  const systemStatus = async () => {
    if (systemCached && Date.now() - Date.parse(systemCached.checkedAt) < 30_000) return systemCached;
    return systemPending ??= (async (): Promise<AptPackageStatus> => {
      const value: AptPackageStatus = { available: null, security: null, broken: null, indexUpdatedAt: null, checkedAt: new Date().toISOString(), error: "System package status is unavailable for this installation." };
      if (!options.packaged) return value;
      return (options.packageStatus ?? readAptPackageStatus)();
    })().then(result => { systemCached = result; return result; }).finally(() => { systemPending = null; });
  };

  const timeoutReport = (): ToolHealth => ({ checkedAt: new Date().toISOString(), cacheSeconds, tools: managedTools.map(tool => ({ name: tool.name, expectedVersion: expectedHelper(options.helpers, tool.file)?.version ?? null, installed: unknown(), effective: { ...unknown(), source: "unavailable" } })), ffprobe: unknown() });
  async function probe(name: "yt-dlp" | "Deno" | "ffprobe", executable: string | null, signal: AbortSignal): Promise<ToolObservation> {
    if (!executable) return observation("missing", "The executable was not found.");
    if (signal.aborted) return unknown();
    try { return observation("ready", null, await probeMediaHelper(name, executable, env, options.command)); }
    catch { return observation("error", "The local version check failed or exceeded its 1.5 second / 4 KiB limit."); }
  }

  async function collect(signal: AbortSignal, installedOnly = false): Promise<ToolHealth> {
    const packages: { installed: ToolObservation; path: string; resolved: string | null; identity: { dev: number; ino: number } | null; expectedVersion: string | null }[] = [];
    for (const tool of managedTools) {
      const expected = expectedHelper(options.helpers, tool.file), packagePath = join(directory, tool.file);
      let installed: ToolObservation = observation("unknown", "Package integrity is available only for a packaged build with release helper metadata.");
      if (options.packaged && expected && !signal.aborted) {
        try {
          installed = await verifyPackage(packagePath, expected.sha256, signal) ?? await probe(tool.name, packagePath, signal);
          if (installed.status === "ready" && installed.version !== expected.version) installed = observation("corrupt", "The verified tool reports a different version from this release.", installed.version);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          installed = code === "ENOENT" ? observation("missing", "The package tool is missing.") : code === "ELOOP" ? observation("corrupt", "The package tool was replaced by a symbolic link. It was not executed.") : observation("unknown", "The package tool could not be read within the check limits.");
        }
      }
      packages.push({ installed, path: packagePath, resolved: signal.aborted ? null : await realpath(packagePath).catch(() => null), identity: signal.aborted ? null : await stat(packagePath).catch(() => null), expectedVersion: expected?.version ?? null });
    }
    let ffprobe: ToolObservation = unknown();
    const probePath = options.packaged ? join(directory, "ffprobe") : env.COUCH_FFPROBE ?? Bun.which("ffprobe", { PATH: env.PATH ?? "/usr/bin:/bin" });
    try {
      const expected = expectedHelper(options.helpers, "ffprobe");
      if (options.packaged) {
        if (expected) {
          ffprobe = await verifyPackage(probePath!, expected.sha256, signal) ?? await probe("ffprobe", probePath, signal);
          if (ffprobe.status === "ready" && ffprobe.version !== expected.version) ffprobe = observation("corrupt", "The bundled ffprobe version differs from this release.");
        }
      } else ffprobe = await probe("ffprobe", probePath, signal);
    } catch (error) {
      ffprobe = observation((error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "corrupt", "The bundled ffprobe is unavailable. Reinstall a verified Couch AppImage.");
    }
    if (installedOnly) return { checkedAt: new Date().toISOString(), cacheSeconds: 0, ffprobe, tools: packages.map((value, index) => ({ name: managedTools[index]!.name, expectedVersion: value.expectedVersion, installed: value.installed, effective: { ...value.installed, source: "package" } })) };
    const tools: ManagedToolHealth[] = [];
    async function effectiveProbe(name: "yt-dlp" | "Deno" | "ffprobe", executable: string | null) {
      if (!executable) return { result: observation("missing", "The executable was not found."), packageIndex: -1 };
      if (signal.aborted) return { result: unknown(), packageIndex: -1 };
      const resolved = await realpath(executable).catch(() => null);
      const identity = await stat(executable).catch(() => null);
      const exact = packages.findIndex(p => executable === p.path || resolved === p.path);
      const packageIndex = exact >= 0 ? exact : packages.findIndex(p => !!resolved && resolved === p.resolved || !!identity && identity.dev === p.identity?.dev && identity.ino === p.identity.ino);
      const packaged = packages[packageIndex];
      const result = packaged ? managedTools[packageIndex]!.name === name ? packaged.installed : observation("error", "The effective executable points to a different package tool.") : resolved ? await probe(name, executable, signal) : observation("missing", "The effective executable was not found or could not be resolved.");
      return { result, packageIndex };
    }
    for (const [index, tool] of managedTools.entries()) {
      const packaged = packages[index]!;
      if (options.packaged) {
        tools.push({ name: tool.name, expectedVersion: packaged.expectedVersion, installed: packaged.installed, effective: { ...packaged.installed, source: "package" } });
        continue;
      }
      const override = env[tool.variable];
      const executable = override?.includes("/") ? override : Bun.which(override || tool.file, { PATH: env.PATH ?? "/usr/bin:/bin" });
      const { result, packageIndex } = await effectiveProbe(tool.name, executable);
      const usesPackage = packageIndex === index;
      const source = usesPackage ? "package" : env[tool.variable] ? "environment" : executable ? "search-path" : "unavailable";
      tools.push({ name: tool.name, expectedVersion: packaged.expectedVersion, installed: packaged.installed, effective: { ...result, source } });
    }
    return { checkedAt: new Date().toISOString(), tools, ffprobe, cacheSeconds };
  }

  return {
    // Filesystem reads may ignore cancellation. Root stops the service and
    // verifies its empty cgroup before taking any maintenance snapshot.
    async close() { shutdown.abort(); },
    async handle(request: Request, identity: () => ControllerIdentity | null): Promise<Response> {
      const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
      const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
      const permitted = () => ["host", "administrator"].includes(identity()?.authority ?? "");
      if (!permitted()) return json({ error: "An administrator is required to check media tools." }, 403);
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
      const url = new URL(request.url);
      if (!["/api/tools", "/api/tools/packages", "/api/tools/ubuntu"].includes(url.pathname)) return json({ error: "Not found." }, 404);
      if (url.search) return json({ error: "Tool checks do not accept parameters." }, 400);
      if (shutdown.signal.aborted) return json({ error: "Couch is shutting down." }, 503);
      // Keep the old path readable for controllers open during an app update.
      if (url.pathname === "/api/tools/packages" || url.pathname === "/api/tools/ubuntu") {
        const result = await systemStatus();
        if (shutdown.signal.aborted) return json({ error: "Couch is shutting down." }, 503);
        return !permitted() ? json({ error: "Administrator access is no longer available." }, 403) : json(result);
      }
      if (!cached || Date.now() - Date.parse(cached.checkedAt) >= cacheSeconds * 1000) {
        // A timed-out filesystem probe remains the single pending collection;
        // repeated requests cannot accumulate work on an unresponsive mount.
        pending ??= collect(AbortSignal.any([shutdown.signal, AbortSignal.timeout(checkMilliseconds)])).catch(timeoutReport).then(report => { cached = report; return report; }).finally(() => { pending = null; });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { cached = await Promise.race([pending, new Promise<ToolHealth>(resolve => { timer = setTimeout(() => resolve(timeoutReport()), checkMilliseconds); })]); }
        finally { clearTimeout(timer); }
      }
      if (!permitted()) return json({ error: "Administrator access is no longer available." }, 403);
      if (shutdown.signal.aborted) return json({ error: "Couch is shutting down." }, 503);
      return json(cached);
    },
  };
}
