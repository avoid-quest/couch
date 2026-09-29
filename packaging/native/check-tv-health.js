// Run with the packaged Deno as couch-tv. Read-only setup check; never expose tokens.
import { readFile, readdir, readlink, stat } from "node:fs/promises";
import process from "node:process";
const [pid, expectedFile, data] = process.argv.slice(2);
if (!/^[1-9][0-9]*$/.test(pid ?? "")) throw new Error("The TV service has no native process.");
const expected = JSON.parse(await readFile(expectedFile, "utf8"));
if ((await stat(`/proc/${pid}`)).uid !== (await stat("/proc/self")).uid || await readlink(`/proc/${pid}/exe`) !== "/usr/bin/couch") throw new Error("The service is not running the installed native Couch.");
const children = (await Promise.all((await readdir(`/proc/${pid}/task`)).map(thread => readFile(`/proc/${pid}/task/${thread}/children`, "utf8").catch(() => "")))).join(" ").trim().split(/\s+/);
const child = (await Promise.all(children.filter(Boolean).map(async candidate => {
  try { return await readlink(`/proc/${candidate}/exe`) === "/usr/bin/couch-server" ? candidate : null; } catch { return null; }
}))).find(Boolean);
// Another Couch starts no local backend; only This computer runs one.
const mode = await readFile(`${data}/operating-mode.json`, "utf8").then(text => JSON.parse(text).mode ?? null, () => null);
if (!child && mode !== "local") {
  console.log(JSON.stringify({ mode: mode ?? "unchosen", nativePid: Number(pid) }));
  process.exit(0);
}
if (!child) throw new Error("The native Couch backend has not started.");
const environment = Object.fromEntries((await readFile(`/proc/${child}/environ`, "utf8")).split("\0").filter(Boolean).map(entry => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]));
if (environment.COUCH_DATA_DIR !== data) throw new Error("The native backend is using another data directory.");
if (!/^[a-f0-9]{64}$/.test(environment.COUCH_HOST_TOKEN ?? "")) throw new Error("The native backend has no host identity.");
const sockets = new Set(await Promise.all((await readdir(`/proc/${child}/fd`)).map(async fd => {
  try { return (await readlink(`/proc/${child}/fd/${fd}`)).match(/^socket:\[(\d+)\]$/)?.[1]; } catch { return null; }
})));
const listener = (await readFile(`/proc/${child}/net/tcp`, "utf8")).trim().split("\n").slice(1).map(line => line.trim().split(/\s+/)).find(fields => fields[3] === "0A" && fields[1].startsWith("0100007F:") && sockets.has(fields[9]));
if (!listener) throw new Error("The native backend has no loopback listener.");
const origin = `http://127.0.0.1:${parseInt(listener[1].split(":")[1], 16)}`;
const get = async path => {
  const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${environment.COUCH_HOST_TOKEN}` }, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("The native backend has not become ready.");
  return response.json();
};
const actual = await get("/api/build");
if (["version", "revision", "dataFormat"].some(key => actual[key] !== expected[key])) throw new Error("The native backend build differs from the installed package.");
if (!(await get("/api/health")).ok) throw new Error("The native backend is unhealthy.");
console.log(JSON.stringify({ version: actual.version, revision: actual.revision, dataFormat: actual.dataFormat, mode: "local", nativePid: Number(pid), backendPid: Number(child) }));
