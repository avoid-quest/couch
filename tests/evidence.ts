import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { environment, record } from "../packaging/tv/evidence.js";

// With COUCH_EVIDENCE=<directory>, a measuring test also writes its result in the
// record `couch-session diagnose` uses (docs/native-tv.md), naming the checkout,
// runtime and machine it ran on, its input route and what it left untested.
export async function writeEvidence(kind: string, fields: { input: string; measured: Record<string, unknown>; untested: string[] }) {
  const directory = process.env.COUCH_EVIDENCE;
  if (!directory) return;
  const git = (...args: string[]) => { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${kind}-${Date.now()}.json`), JSON.stringify(record(kind, {
    revision: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain") !== "",
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node },
    environment: await environment(), ...fields,
  }), null, 2));
}

export const percentile = (sorted: number[], fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!;
