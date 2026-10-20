// The record shared by `couch-session diagnose` and measured test runs on TV
// hardware (docs/native-tv.md), so each names the environment it came from,
// what it measured and what it left untested.
import { readFile, readdir, readlink } from "node:fs/promises";
import { basename } from "node:path";
import os from "node:os";
import { redact } from "./redact.js";

export const schema = "couch-evidence/1";
// Physical conditions that neither a passive report nor a loopback test exercises.
export const physical = ["decoded picture on the TV", "audible output", "HDMI hotplug", "standby resume", "physical remote input", "speaker and screen alignment"];

export const record = (kind, fields) => ({ schema, kind, at: new Date().toISOString(), ...fields });

class Timeout extends Error {}
// One observation can't hold up the rest: it is observed, unavailable or timed out.
export async function observe(timeout, read) {
  const started = performance.now();
  let timer;
  const ms = () => Math.round(performance.now() - started);
  try {
    const value = await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Timeout()), timeout); })]);
    return { status: "observed", ms: ms(), value };
  } catch (error) {
    return error instanceof Timeout ? { status: "timeout", ms: ms() } : { status: "unavailable", ms: ms(), reason: redact(error, 200) };
  } finally { clearTimeout(timer); }
}

// The machine: OS, kernel, CPU, memory and graphics devices. root prefixes fixed system paths in tests.
export async function environment(root = "") {
  const release = Object.fromEntries((await readFile(`${root}/etc/os-release`, "utf8").catch(() => "")).split("\n")
    .map(line => /^(ID|VERSION_ID|PRETTY_NAME)=("?)(.*)\2$/.exec(line)).filter(Boolean).map(match => [match[1], match[3].slice(0, 80)]));
  const cards = (await readdir(`${root}/sys/class/drm`).catch(() => [])).filter(name => /^card\d+$/.test(name));
  const gpus = await Promise.all(cards.map(async card => {
    const read = name => readFile(`${root}/sys/class/drm/${card}/device/${name}`, "utf8").then(text => text.trim().replace(/^0x/, ""), () => null);
    return { vendor: await read("vendor"), device: await read("device"), driver: await readlink(`${root}/sys/class/drm/${card}/device/driver`).then(basename, () => null) };
  }));
  const cpus = os.cpus();
  return {
    os: { id: release.ID ?? null, version: release.VERSION_ID ?? null, name: release.PRETTY_NAME ?? null },
    kernel: os.release(), arch: process.arch,
    cpu: { model: cpus[0]?.model.trim() ?? null, count: cpus.length },
    memoryMiB: Math.round(os.totalmem() / 2 ** 20),
    gpus: gpus.filter((gpu, index) => gpus.findIndex(other => JSON.stringify(other) === JSON.stringify(gpu)) === index),
  };
}
