// Run as couch-tv with the app's own Node: ELECTRON_RUN_AS_NODE=1 /usr/bin/couch check-health.js <pid> <data dir>.
// Read-only setup check; never expose tokens.
import { readFile, readdir, readlink, stat } from "node:fs/promises";
import process from "node:process";
const [pid, data] = process.argv.slice(2);
// The installed Couch running this check: /opt/Couch/couch, or /opt/Couch Preview/couch for a preview.
const app = process.execPath;
if (!/^[1-9][0-9]*$/.test(pid ?? "")) throw new Error("The TV service has no Couch process.");
if ((await stat(`/proc/${pid}`)).uid !== (await stat("/proc/self")).uid || await readlink(`/proc/${pid}/exe`) !== app) throw new Error("The service is not running the installed Couch.");
const children = (await Promise.all((await readdir(`/proc/${pid}/task`)).map(thread => readFile(`/proc/${pid}/task/${thread}/children`, "utf8").catch(() => "")))).join(" ").trim().split(/\s+/);
// Core is the app's Node utility process.
const child = (await Promise.all(children.filter(Boolean).map(async candidate => {
  try { return await readlink(`/proc/${candidate}/exe`) === app && (await readFile(`/proc/${candidate}/cmdline`, "utf8")).includes("node.mojom.NodeService") ? candidate : null; } catch { return null; }
}))).find(Boolean);
// Another Couch starts no local Core; only This computer runs one.
const mode = await readFile(`${data}/operating-mode.json`, "utf8").then(text => JSON.parse(text).mode ?? null, () => null);
if (!child && mode === "remote") {
  console.log(JSON.stringify({ mode, appPid: Number(pid) }));
  process.exit(0);
}
if (!child) throw new Error("Couch Core has not started.");
const environment = Object.fromEntries((await readFile(`/proc/${child}/environ`, "utf8")).split("\0").filter(Boolean).map(entry => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]));
if (environment.COUCH_DATA_DIR !== data) throw new Error("Couch Core is using another data directory.");
if (!/^[a-f0-9]{64}$/.test(environment.COUCH_HOST_TOKEN ?? "")) throw new Error("Couch Core has no host identity.");
const sockets = new Set(await Promise.all((await readdir(`/proc/${child}/fd`)).map(async fd => {
  try { return (await readlink(`/proc/${child}/fd/${fd}`)).match(/^socket:\[(\d+)\]$/)?.[1]; } catch { return null; }
})));
const listener = (await readFile(`/proc/${child}/net/tcp`, "utf8")).trim().split("\n").slice(1).map(line => line.trim().split(/\s+/)).find(fields => fields[3] === "0A" && fields[1].startsWith("0100007F:") && sockets.has(fields[9]));
if (!listener) throw new Error("Couch Core has no loopback listener.");
const origin = `http://127.0.0.1:${parseInt(listener[1].split(":")[1], 16)}`;
const response = await fetch(`${origin}/api/health`, { headers: { Authorization: `Bearer ${environment.COUCH_HOST_TOKEN}` }, signal: AbortSignal.timeout(3000) });
if (!response.ok || !(await response.json()).ok) throw new Error("Couch Core is unhealthy.");
const build = await (await fetch(`${origin}/api/build`, { headers: { Authorization: `Bearer ${environment.COUCH_HOST_TOKEN}` }, signal: AbortSignal.timeout(3000) })).json();
console.log(JSON.stringify({ version: build.version, revision: build.revision, mode: mode ?? "local", appPid: Number(pid), corePid: Number(child) }));
