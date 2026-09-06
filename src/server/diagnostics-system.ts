import { execFile } from "node:child_process";
import { open, statfs } from "node:fs/promises";
import { arch, platform, release, uptime } from "node:os";
import { dirname } from "node:path";
import type { DiagnosticFact, DiagnosticHelper, NativeDiagnostics } from "../shared/diagnostics";
import { redactDiagnosticText } from "./diagnostics-redaction";

export function diagnosticBuild(value: unknown): NativeDiagnostics["build"] {
  const build = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const field = (name: string, pattern: RegExp) => typeof build[name] === "string" && pattern.test(build[name]) ? build[name] : null;
  return { version: field("version", /^[\d][\dA-Za-z.+-]{0,100}$/), revision: field("revision", /^[a-f\d]{7,64}$/), target: field("target", /^[\w-]{1,80}$/), packaged: build.packaged === true };
}

export function runDiagnosticCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  // Only fixed read-only commands reach here; no credentials are inherited.
  return new Promise((resolve, reject) => execFile(command, args, { timeout: 1_500, maxBuffer: 4096, env, encoding: "utf8", killSignal: "SIGKILL" }, (error, stdout) => error ? reject(new Error("The command failed or exceeded its 1.5 second / 4 KiB limit.")) : resolve(stdout.trim())));
}

async function osName(): Promise<string> {
  if (platform() !== "linux") return platform();
  const file = await open("/etc/os-release", "r");
  try {
    const buffer = Buffer.alloc(16_384);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return /^PRETTY_NAME=["']?([^\r\n"']+)/m.exec(buffer.toString("utf8", 0, bytesRead))?.[1] ?? "Linux";
  } finally { await file.close(); }
}

export async function systemFacts(databasePath: string): Promise<DiagnosticFact[]> {
  const facts: DiagnosticFact[] = [
    { name: "Operating system", value: await osName().catch(() => platform()), source: "/etc/os-release or operating system" },
    { name: "Kernel", value: release(), source: "Operating system" },
    { name: "Architecture", value: arch(), source: "Coordinator runtime" },
    { name: "System uptime in seconds", value: Math.floor(uptime()), source: "Operating system" },
    { name: "Coordinator uptime in seconds", value: Math.floor(process.uptime()), source: "Coordinator process" },
    { name: "Coordinator", value: "Ready", source: "This authenticated HTTP response" },
    { name: "Bun", value: Bun.version, source: "Running coordinator" },
  ];
  try {
    const storage = await statfs(dirname(databasePath));
    facts.push({ name: "Available storage in bytes", value: storage.bavail * storage.bsize, source: "Filesystem containing Couch data" });
    facts.push({ name: "Total storage in bytes", value: storage.blocks * storage.bsize, source: "Filesystem containing Couch data" });
  } catch { facts.push({ name: "Available storage in bytes", value: null, source: "Could not read the Couch data filesystem" }); }
  return facts;
}

export function configurationFacts(env: NodeJS.ProcessEnv, runtime: { hostname: string; port: number; native: boolean }): DiagnosticFact[] {
  const facts: DiagnosticFact[] = [
    { name: "Listen address", value: runtime.hostname, source: env.COUCH_HOST === undefined ? "Application default" : "COUCH_HOST environment" },
    { name: "Listen port", value: runtime.port, source: env.COUCH_PORT === undefined ? "Application default" : "COUCH_PORT environment" },
    { name: "Data location", value: "External application data directory", source: runtime.native ? "Native host, see its effective configuration below" : env.COUCH_DATA_DIR === undefined ? "Development default .data" : "COUCH_DATA_DIR environment" },
    { name: "Advertised addresses", value: env.COUCH_ADVERTISE_URLS === undefined ? "Detected LAN addresses" : "Explicit addresses", source: env.COUCH_ADVERTISE_URLS === undefined ? "Network interfaces" : "COUCH_ADVERTISE_URLS environment; URL values omitted" },
  ];
  if (runtime.native) facts.push({ name: "Environment origin", value: "Values inherited by the running process", source: "Launcher, environment file or service override; exact upstream file is not observable here" });
  return facts;
}

const helperCommands = {
  "yt-dlp": { args: ["--ignore-config", "--no-plugin-dirs", "--version"], pattern: /^(\d{4}\.\d{2}\.\d{2}(?:[\w.+-]*))$/ },
  Deno: { args: ["--version"], pattern: /^deno ([\d]+\.[\d]+\.[\d]+[\w.+-]*)\b/ },
  ffprobe: { args: ["-version"], pattern: /^ffprobe version ([\w.+:~-]+)/ },
};

export async function probeMediaHelper(name: keyof typeof helperCommands, executable: string, env: NodeJS.ProcessEnv, command = runDiagnosticCommand): Promise<string> {
  const helper = helperCommands[name];
  const output = await command(executable, helper.args, { PATH: env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C" });
  const version = helper.pattern.exec(output.split("\n")[0] ?? "")?.[1];
  if (!version || version.length > 100) throw new Error("The version output was not recognized.");
  return version;
}

export async function helperFacts(env: NodeJS.ProcessEnv, command = runDiagnosticCommand): Promise<DiagnosticHelper[]> {
  const safeEnv = { PATH: env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
  return Promise.all([
    { name: "yt-dlp" as const, variable: "COUCH_YT_DLP" },
    { name: "Deno" as const, variable: "COUCH_DENO" },
    { name: "ffprobe" as const, variable: "" },
  ].map(async helper => {
    const executable = helper.variable && env[helper.variable] || Bun.which(helper.name.toLowerCase(), { PATH: safeEnv.PATH });
    const source = helper.variable && env[helper.variable] ? `${helper.variable} effective environment` : "Executable search path";
    const checkedAt = new Date().toISOString();
    if (!executable) return { name: helper.name, version: null, status: "unavailable" as const, source, error: "Executable was not found.", checkedAt };
    try {
      const version = await probeMediaHelper(helper.name, executable, safeEnv, command);
      return { name: helper.name, version, status: "ready" as const, source, error: null, checkedAt };
    } catch (error) {
      return { name: helper.name, version: null, status: "error" as const, source, error: redactDiagnosticText(error instanceof Error ? error.message : "Could not query the helper."), checkedAt };
    }
  }));
}
