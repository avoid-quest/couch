// Run as couch-tv with the app's own Node: ELECTRON_RUN_AS_NODE=1 /usr/bin/couch check-health.js <pid> <data dir>.
// Read-only setup check: the running app is the installed Couch and, in This computer mode,
// its Core has this data directory's couch.sqlite open and answers /api/health on loopback.
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
// Electron can overwrite /proc's initial environment when setting process titles.
// Verify the database Core actually opened, including data-directory symlinks.
// Only stat descriptors that name a couch.sqlite, so a hung mount behind another fd cannot block the check.
const descriptors = (await readdir(`/proc/${child}/fd`)).map(fd => `/proc/${child}/fd/${fd}`);
const database = await stat(`${data}/couch.sqlite`);
const files = await Promise.all(descriptors.map(fd => readlink(fd).then(target => target.endsWith("/couch.sqlite") ? stat(fd) : null).catch(() => null)));
if (!files.some(file => file?.dev === database.dev && file.ino === database.ino)) throw new Error("Couch Core is using another data directory.");
const sockets = new Set(await Promise.all(descriptors.map(async fd => {
  try { return (await readlink(fd)).match(/^socket:\[(\d+)\]$/)?.[1]; } catch { return null; }
})));
const listener = (await readFile(`/proc/${child}/net/tcp`, "utf8")).trim().split("\n").slice(1).map(line => line.trim().split(/\s+/)).find(fields => fields[3] === "0A" && fields[1].startsWith("0100007F:") && sockets.has(fields[9]));
if (!listener) throw new Error("Couch Core has no loopback listener.");
const origin = `http://127.0.0.1:${parseInt(listener[1].split(":")[1], 16)}`;
// Health is read-only and needs no host token; the socket belongs to this Core.
const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) });
if (!response.ok || !(await response.json()).ok) throw new Error("Couch Core is unhealthy.");
console.log(JSON.stringify({ mode: mode ?? "local", appPid: Number(pid), corePid: Number(child) }));
