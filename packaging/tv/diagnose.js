// Run as couch-tv by `sudo couch-session diagnose [--json]`, with the app's own Node:
// ELECTRON_RUN_AS_NODE=1 /usr/bin/couch diagnose.js [--json] <data dir> <setup state>.
// A passive, allowlisted report. Each observation has its own time limit and is
// reported unknown on its own. It never opens couch.sqlite, runs or updates a
// helper, plays, captures or tests media, or changes a setting, and it leaves out
// keys, tokens, settings, the environment, executable paths and source URLs.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open, readFile, readdir } from "node:fs/promises";
import process from "node:process";
import { environment, observe, physical, record } from "./evidence.js";
import { redact } from "./redact.js";

const json = process.argv[2] === "--json";
const [data, setup = "unknown"] = process.argv.slice(json ? 3 : 2);
if (!data) { console.error("Usage: diagnose.js [--json] <data dir> <setup state>"); process.exit(2); }
// Tests read a fixture tree; couch-session never sets this.
const root = process.env.COUCH_DIAGNOSE_ROOT ?? "";
const limit = 3_000;

// stdout of a command that ran, even when it exited non-zero (systemctl is-enabled does for disabled).
// Its observation times out first; the command is killed just after.
const children = new Set();
const run = (command, args, options = {}) => new Promise((resolve, reject) => children.add(execFile(command, args, { timeout: limit + 500, killSignal: "SIGKILL", maxBuffer: 256 * 1024, ...options }, (error, stdout, stderr) => {
  if (!error || (typeof error.code === "number" && options.anyExit)) resolve(stdout);
  // Node ends an uncaught error's report with its version; the error line, `Error: …`
  // or, for an error with properties, `[Error: …] {`, says what failed.
  else reject(new Error(redact(stderr.split("\n").findLast(line => /^\[?\w*Error\b/.test(line))?.replace(/^\[(.*)\](?: \{)?$/, "$1") || stderr.trim().split("\n").at(-1) || `${command} did not run`, 200)));
})));
// At most `bytes` of a regular file, from its start or its end: nothing larger is ever read.
// Non-blocking, so a FIFO planted in place of a file can't hold a reader (or exit) forever.
async function text(path, bytes = 64 * 1024, end = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = await file.stat(), { size } = stats;
    if (!stats.isFile()) throw new Error("Not a regular file.");
    const length = Math.min(size, bytes), buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, end ? size - length : 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await file.close(); }
}
// A parse error quotes the text it failed on, which may be a pairing pin or a token.
const jsonFile = async path => { const value = await text(path); try { return JSON.parse(value); } catch { throw new Error("The record is not valid JSON."); } };
const word = (value, pattern = /^[\w.+~:@-]{1,80}$/) => typeof value === "string" && pattern.test(value) ? value : null;
const time = value => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value.slice(0, 40) : null;
const properties = output => Object.fromEntries(output.trim().split("\n").map(line => line.split(/=(.*)/s).slice(0, 2)));

const service = observe(limit, async () => {
  const value = properties(await run("systemctl", ["--user", "show", "couch-tv.service", "--property=ActiveState,SubState,MainPID,NRestarts,Result,ExecMainStartTimestamp"]));
  return { active: word(value.ActiveState), sub: word(value.SubState), pid: Number(value.MainPID) || null, restarts: Number(value.NRestarts) || 0, result: word(value.Result), since: value.ExecMainStartTimestamp?.slice(0, 40) || null };
});
// 0 when the service runs no process; null when that is unknown.
const pid = service.then(result => result.status === "observed" ? result.value.pid ?? 0 : null);

const observations = {
  environment: observe(limit, () => environment(root)),
  package: observe(limit, async () => ({ version: word((await run("dpkg-query", ["-W", "-f=${Version}", "couch"])).trim()) })),
  service,
  // The check setup and updates rely on: process and Core health, not the window or media.
  health: pid.then(main => observe(10_000, async () => {
    if (!main) throw new Error("The TV service has no Couch process.");
    const output = await run(process.execPath, [new URL("./check-health.js", import.meta.url).pathname, String(main), data], { timeout: 10_500, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
      .then(stdout => JSON.parse(stdout), error => ({ error: error.message }));
    return output.error ? { ok: false, error: output.error } : { ok: true, mode: word(output.mode), core: !!output.corePid };
  })),
  // The window's lifecycle as Main last recorded it (app/renderer-status.ts).
  window: pid.then(main => observe(limit, async () => {
    const status = await jsonFile(`${data}/renderer-status.json`);
    return {
      state: word(status.state), page: word(status.page), navigation: Number.isInteger(status.navigation) ? status.navigation : null, reason: status.reason ? redact(status.reason, 80) : null,
      run: word(status.run), version: word(status.version), startedAt: time(status.startedAt), at: time(status.at),
      // Only the service's running process makes it this run's. A different process
      // wrote it in an earlier run; null when the service couldn't be asked.
      current: main === null ? null : !!main && status.pid === main,
    };
  })),
  mode: observe(limit, async () => {
    const choice = await jsonFile(`${data}/operating-mode.json`);
    return { mode: ["local", "remote"].includes(choice.mode) ? choice.mode : null, tvPresentation: choice.tvPresentation === true };
  }),
  helpers: observe(limit, () => helpers(`${data}/helpers`)),
  update: observe(limit, async () => {
    const status = properties(await text(`${root}/var/lib/couch-update/status`, 4096));
    return { at: time(status.at), mode: word(status.mode), version: word(status.version), outcome: word(status.outcome), error: status.error ? redact(status.error, 200) : null, failed: word(status.failed), rollback: word(status.rollback), setup: word(status.setup) };
  }),
  timer: observe(limit, async () => ({ state: word((await run("systemctl", ["is-enabled", "couch-update.timer"], { anyExit: true })).trim()) })),
  display: observe(limit, display),
  audio: observe(limit, async () => {
    const [sink, sinks] = await Promise.all([run("pactl", ["get-default-sink"]), run("pactl", ["list", "short", "sinks"])]);
    return { defaultSink: redact(sink.trim(), 120), sinks: sinks.trim().split("\n").filter(Boolean).slice(0, 16).map(line => { const [, name, , , state] = line.split("\t"); return { name: redact(name ?? "", 120), state: word(state) }; }) };
  }),
  log: observe(limit, () => log(`${data}/logs/couch.log`)),
};

// Core's record of the helpers it selected (src/server/helper-status.ts). Never
// runs, checks or updates a helper, or guesses one from the cache.
async function helpers(directory) {
  const status = await jsonFile(`${directory}/status.json`);
  if (status.schema !== 1) throw new Error("Unknown helper status format.");
  const hold = await jsonFile(`${directory}/hold.json`).catch(() => null);
  const names = ["yt-dlp", "qjs", "ffmpeg", "mpv"];
  const selected = Object.fromEntries(names.filter(name => status.selected?.[name]).map(name => {
    const helper = status.selected[name];
    return [name, { origin: ["system", "managed"].includes(helper.origin) ? helper.origin : null, version: redact(helper.version ?? "", 80) || null, sha256: word(helper.sha256, /^[\da-f]{64}$/), verifiedAt: time(helper.verifiedAt), latest: word(helper.latest), held: helper.held === true }];
  }));
  const managed = Object.fromEntries(names.filter(name => status.managed?.[name]).map(name => [name, Object.entries(status.managed[name]).slice(0, 8).map(([version, copy]) => ({
    version: word(version), installedAt: time(copy?.installedAt), worked: Object.fromEntries(Object.entries(copy?.worked ?? {}).slice(0, 16).map(([provider, at]) => [word(provider) ?? "other", time(at)])),
  }))]));
  const active = hold?.schema === 1 && Date.parse(hold.until) > Date.now();
  return { selected, managed, hold: hold?.schema === 1 ? { helper: word(hold.helper), version: word(hold.version), since: time(hold.since), until: time(hold.until), active } : null };
}

// Connectors from the kernel, and the X screen's current modes when the session's display answers.
async function display() {
  const connectors = await Promise.all((await readdir(`${root}/sys/class/drm`).catch(() => [])).filter(name => /^card\d+-/.test(name)).map(async name => {
    const read = file => readFile(`${root}/sys/class/drm/${name}/${file}`, "utf8").then(value => value.trim(), () => null);
    return { connector: name.replace(/^card\d+-/, ""), status: word(await read("status")), enabled: word(await read("enabled")), preferred: word((await read("modes"))?.split("\n")[0]) };
  }));
  const session = properties(await run("systemctl", ["--user", "show-environment"]).catch(() => ""));
  const screens = !session.DISPLAY ? null : await run("xrandr", ["--current"], { env: { PATH: process.env.PATH, DISPLAY: session.DISPLAY, ...session.XAUTHORITY ? { XAUTHORITY: session.XAUTHORITY } : {} } })
    .then(output => [...output.matchAll(/^(\S+) connected( primary)? (\d+x\d+)\+\d+\+\d+.*\n((?:\s+.*\n?)*)/gm).map(([, output, primary, mode, modes]) => ({
      output, primary: !!primary, mode, refresh: Number(/([\d.]+)\*/.exec(modes)?.[1]) || null,
    }))], error => ({ unavailable: error.message }));
  return { connectors, screens: screens ?? { unavailable: "No graphical session" } };
}

// Only structured lines from the newest 256 KB: the run header, the last delivery
// route (without device names), player error hosts and Main's redacted errors.
async function log(path) {
  const tail = (await text(path, 256 * 1024, true)).split("\n");
  const iso = "(\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z)";
  const header = tail.map(line => new RegExp(`^${iso} main info: Couch (\\S+) run (\\S+) pid \\d+ log (\\d+)$`).exec(line)).filter(Boolean).at(-1);
  const delivery = tail.map(line => new RegExp(`^${iso} playback [\\da-f]+ (Direct|Synced) on (.*)$`).exec(line)).filter(Boolean).at(-1);
  const playerErrors = tail.map(line => new RegExp(`^${iso} player error \\S+ .*?host=([\\w.-]+):`).exec(line)).filter(Boolean);
  const errors = tail.map(line => new RegExp(`^${iso} (main|renderer|update) error: (.*)$`).exec(line)).filter(Boolean).slice(-5);
  return {
    run: header ? { at: header[1], version: word(header[2]), run: word(header[3]), file: Number(header[4]) } : null,
    delivery: delivery ? { at: delivery[1], route: delivery[2], buffered: delivery[3].includes(" (buffered)"), unavailable: delivery[3].includes(" (unavailable)") } : null,
    playerErrors: { count: playerErrors.length, hosts: [...new Set(playerErrors.map(match => match[2]))].slice(-5), last: playerErrors.at(-1)?.[1] ?? null },
    errors: errors.map(([, at, component, message]) => ({ at, component, message: redact(message, 300) })),
  };
}

const results = Object.fromEntries(await Promise.all(Object.entries(observations).map(async ([name, promise]) => [name, await promise])));
const value = name => results[name].status === "observed" ? results[name].value : null;
// The local shell apart from what the window shows: another Couch that can't be reached isn't a broken app.
const window = value("window");
const report = record("diagnose", {
  setup: ["complete", "pending", "none"].includes(setup) ? setup : "unknown",
  runtime: { electron: process.versions.electron ?? null, chrome: process.versions.chrome ?? null, node: process.versions.node },
  summary: {
    service: value("service")?.active ?? "unknown",
    core: !value("health") ? "unknown" : value("health").ok ? value("health").core ? "healthy" : "not-run" : "failed",
    window: !window || window.current === null ? "unknown" : !window.current ? "stale" : window.state === "failed" && window.page === "remote" ? "remote-failed" : window.state ?? "unknown",
  },
  observations: results,
  measured: [],
  untested: physical,
});

if (json) console.log(JSON.stringify(report, null, 2));
else {
  const line = (label, name, describe) => {
    const result = results[name];
    console.log(`${label}: ${result.status === "observed" ? describe(result.value) : result.status === "timeout" ? `timed out after ${result.ms} ms` : `unavailable (${result.reason})`}`);
  };
  console.log("Couch TV diagnosis. Passive: nothing was played, captured, installed or changed.");
  line("Package", "package", value => `couch ${value.version ?? "unknown"}; Electron ${report.runtime.electron ?? "unknown"}, Node ${report.runtime.node}`);
  line("System", "environment", value => `${value.os.name ?? "unknown OS"}, kernel ${value.kernel}, ${value.arch}, ${value.cpu.model ?? "CPU"} × ${value.cpu.count}, ${value.memoryMiB} MiB, GPU ${value.gpus.map(gpu => `${gpu.vendor}:${gpu.device} ${gpu.driver ?? ""}`.trim()).join(", ") || "none found"}`);
  console.log(`Setup: ${report.setup}`);
  line("Service", "service", value => `${value.active} (${value.sub}), ${value.restarts} restarts${value.since ? `, since ${value.since}` : ""}`);
  line("Core", "health", value => value.ok ? value.core ? "healthy" : "not run here (Another Couch mode)" : `failed: ${value.error}`);
  line("Window", "window", value => value.current === null ? `unknown: the service couldn't be asked which process runs (last report: ${value.state} at ${value.at})`
    : !value.current ? `no report from a running Couch (last: ${value.state} at ${value.at})`
    : value.state === "failed" && value.page === "remote" ? `couldn't load another Couch (${value.reason}); the local app is running`
    : value.state === "page-loaded" ? `${value.page === "remote" ? "another Couch's" : "this Couch's"} page loaded, but its app hasn't reported mounting (it failed to start, or that Couch predates the report)`
    : `${value.state}, ${value.page === "remote" ? "another Couch's" : "this Couch's"} page${value.reason ? ` (${value.reason})` : ""}, Couch ${value.version}`);
  line("Mode", "mode", value => value.mode === "remote" ? "Another Couch" : value.mode === "local" ? "This computer" : "not chosen");
  line("Helpers", "helpers", value => Object.entries(value.selected).map(([name, helper]) => `${name} ${helper.version} (${helper.origin}${helper.held ? ", held" : ""})`).join("; ") + (value.hold?.active ? `; hold on yt-dlp ${value.hold.version} until ${value.hold.until}` : ""));
  line("Display", "display", value => [...value.connectors.map(connector => `${connector.connector} ${connector.status}`), ...Array.isArray(value.screens) ? value.screens.map(screen => `${screen.output} ${screen.mode}${screen.refresh ? ` ${screen.refresh} Hz` : ""}${screen.primary ? " primary" : ""}`) : [`X screen ${value.screens.unavailable}`]].join("; ") || "no connectors");
  line("Audio", "audio", value => `default ${value.defaultSink}${value.sinks.length ? `; sinks ${value.sinks.map(sink => `${sink.name} ${sink.state}`).join(", ")}` : ""}`);
  line("Updates", "update", value => `last ${value.mode} run ${value.outcome}${value.version ? ` ${value.version}` : ""} at ${value.at}${value.error ? `: ${value.error}` : ""}`);
  line("Update timer", "timer", value => value.state);
  line("Log", "log", value => [value.run ? `run ${value.run.run}, Couch ${value.run.version}` : "no run header",
    value.delivery ? `last delivery ${value.delivery.route}${value.delivery.buffered ? " (buffered)" : ""}${value.delivery.unavailable ? " (unavailable)" : ""} at ${value.delivery.at}` : "no delivery",
    `${value.playerErrors.count} player errors${value.playerErrors.hosts.length ? ` (${value.playerErrors.hosts.join(", ")})` : ""}`,
    ...value.errors.map(error => `${error.at} ${error.component}: ${error.message}`)].join("; "));
  console.log(`Not tested: ${physical.join(", ")}.`);
}
// Commands still running timed out; they go with the report. The report is out
// even if a read stuck on a hung mount delays the exit.
for (const child of children) child.kill("SIGKILL");
process.exit(0);
