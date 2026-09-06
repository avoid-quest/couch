import { stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const name = "couch-preview";
const label = "quest.avoid.couch.preview";
const image = "couch-preview:ubuntu24.04";
const desktop = "http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale";
const remote = "http://127.0.0.1:4100";
const args = process.argv.slice(2);
const command = ["stop", "logs"].includes(args[0] ?? "") ? args.shift() : "start";
let media: string | undefined;
let localOnly = false;
while (args.length) {
  const arg = args.shift();
  if (arg === "--media" && args[0] && !args[0].startsWith("--")) media = resolve(args.shift()!);
  else if (arg === "--local-only") localOnly = true;
  else throw new Error("Usage: bun run preview:linux [--media /path/to/folder] [--local-only] | stop | logs");
}
if (command !== "start" && (media || localOnly)) throw new Error("Preview options apply only when starting.");
if (media && !(await stat(media)).isDirectory()) throw new Error("--media requires a folder.");

async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`${command.slice(0, 2).join(" ")} failed`);
}

async function inspect(): Promise<{ State: { Running: boolean }; Config: { Labels: Record<string, string> | null } } | null> {
  const child = Bun.spawn(["docker", "container", "inspect", name], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(child.stdout).text();
  return await child.exited === 0 ? JSON.parse(output)[0] : null;
}

await run(["docker", "info", "--format", "Docker {{.ServerVersion}} / {{.Architecture}}"]);
const existing = await inspect();
if (existing && existing.Config.Labels?.[label] !== root) throw new Error(`${name} belongs to another checkout. Stop it there first.`);
if (command === "stop") {
  if (existing?.State.Running) await run(["docker", "stop", name]);
  if (existing) await run(["docker", "rm", name]);
  console.log("Preview stopped. Saved settings and media libraries remain in the couch-preview-data Docker volume.");
  process.exit(0);
}
if (command === "logs") {
  if (!existing) throw new Error("No preview exists. Start it with bun run preview:linux.");
  await run(["docker", "logs", "--follow", name]);
  process.exit(0);
}
if (existing?.State.Running) {
  console.log(`Remote control (real web UI): ${remote}\nLinux TV screen (Docker preview): ${desktop}\nPreview already running. Stop it before rebuilding: bun run preview:linux stop`);
  if (process.platform === "darwin") await Bun.spawn(["open", remote], { stdout: "ignore", stderr: "ignore" }).exited;
  process.exit(0);
}
if (existing) await run(["docker", "rm", name]);

await run(["docker", "build", "--progress", "plain", "-t", "couch-linux-test:ubuntu24.04", "tests/linux"]);
await run(["docker", "build", "--progress", "plain", "-t", image, "tests/preview"]);
const remoteUrls = localOnly ? [] : [...new Set(Object.values(networkInterfaces()).flatMap(entries =>
  (entries ?? []).filter(entry => entry.family === "IPv4" && !entry.internal).map(entry => `http://${entry.address}:4100`),
))];
console.log(`Desktop stays on this computer. ${localOnly ? "Remote also stays on this computer." : "Paired remote publishes on port 4100 for your LAN."}`);
await run([
  "docker", "run", "--detach", "--init", "--name", name, "--label", `${label}=${root}`, "--shm-size=1g",
  "--publish", "127.0.0.1:6080:6080", "--publish", `${localOnly ? "127.0.0.1" : "0.0.0.0"}:4100:4100`,
  "--mount", `type=bind,source=${root},target=/source,readonly`,
  "--mount", "type=volume,source=couch-linux-target,target=/cache/target",
  "--mount", "type=volume,source=couch-linux-registry,target=/root/.cargo/registry",
  "--mount", "type=volume,source=couch-linux-bun,target=/root/.bun/install/cache",
  "--mount", "type=volume,source=couch-preview-data,target=/root/.local/share",
  ...(media ? ["--mount", `type=bind,source=${media},target=/media/host,readonly`, "--env", "COUCH_PREVIEW_MEDIA=1"] : []),
  "--env", "COUCH_DATA_DIR=/root/.local/share/quest.avoid.couch",
  "--env", `COUCH_ADVERTISE_URLS=${remoteUrls.join(",")}`,
  image,
]);

console.log("Building and starting the Linux app. The first build can take several minutes.");
const logs = Bun.spawn(["docker", "logs", "--follow", name], { stdout: "inherit", stderr: "inherit" });
try {
  const deadline = Date.now() + 20 * 60_000;
  while (true) {
    if (!(await inspect())?.State.Running) throw new Error("The preview exited. Inspect it with bun run preview:linux logs.");
    const ready = await Promise.all([
      fetch("http://127.0.0.1:4100/api/health", { signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false),
      fetch("http://127.0.0.1:6080/vnc.html", { signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false),
    ]);
    if (ready.every(Boolean)) break;
    if (Date.now() > deadline) throw new Error("Preview is still starting. Follow it with bun run preview:linux logs.");
    await Bun.sleep(1000);
  }
} finally { logs.kill(); await logs.exited; }

console.log(`\nRemote control (real web UI): ${remote}`);
console.log(`Linux TV screen (Docker preview): ${desktop}${remoteUrls.map(url => `\nPhone remote: ${url}`).join("")}`);
console.log(`Use the pairing code shown on the Linux TV screen. Open /mnt/fixtures/multitrack.mkv there to try playback.${media ? " Your media folder is /media/host inside Linux; add it in Settings > Sources." : " To use your files, restart with --media /path/to/folder."}`);
console.log("This Docker preview uses software video and silent audio. It keeps running until bun run preview:linux stop.");
if (process.platform === "darwin") await Bun.spawn(["open", remote], { stdout: "ignore", stderr: "ignore" }).exited;
