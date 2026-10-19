import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Helper } from "./helpers";

// What Core actually selected for each helper, kept in <data>/helpers/status.json so a
// diagnosis can name the executable that runs. Only Core writes it; reading it, or the
// recovery hold beside it, never checks, downloads or selects a helper.
export type SelectedHelper = {
  origin: "system" | "managed";
  // A managed copy's release; a system copy's first line of --version.
  version: string;
  path: string;
  // The SHA-256 Couch verified when it downloaded this copy; null for system copies
  // and copies downloaded before Couch recorded it.
  sha256: string | null;
  // When the selection check last ran this executable.
  verifiedAt: string;
  // yt-dlp's latest release seen by that check; null when offline, held or not checked.
  latest: string | null;
  // Selected by an operator's hold (`--helpers previous`), not by the update check.
  held: boolean;
};
// A managed copy on disk. `worked` maps a provider (or "other") to the last time an
// extraction with this copy succeeded; running --version alone doesn't count.
export type ManagedCopy = { sha256: string | null; installedAt: string | null; worked: Record<string, string> };
export type HelperStatus = {
  schema: 1;
  selected: Partial<Record<Helper, SelectedHelper>>;
  managed: Partial<Record<Helper, Record<string, ManagedCopy>>>;
};
// <data>/helpers/hold.json, written only by `--helpers previous` and removed by `--helpers latest`.
export type HelperHold = { schema: 1; helper: "yt-dlp"; version: string; since: string; until: string };

const empty = (): HelperStatus => ({ schema: 1, selected: {}, managed: {} });

async function readJson(file: string) {
  try { return JSON.parse(await readFile(file, "utf8")) as unknown; } catch { return null; }
}

// Written beside the file and renamed over it, so a reader never sees half of it.
export async function writeJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export async function readStatus(directory: string): Promise<HelperStatus> {
  const status = await readJson(join(directory, "status.json")) as HelperStatus | null;
  return status?.schema === 1 ? status : empty();
}

export async function readHold(directory: string): Promise<HelperHold | null> {
  const hold = await readJson(join(directory, "hold.json")) as HelperHold | null;
  return hold?.schema === 1 && hold.helper === "yt-dlp" && typeof hold.version === "string" && !Number.isNaN(Date.parse(hold.until)) ? hold : null;
}

export const activeHold = (hold: HelperHold | null) => hold && Date.parse(hold.until) > Date.now() ? hold : null;

export const removeHold = (directory: string) => rm(join(directory, "hold.json"), { force: true });

// The passive view for diagnosis: the recorded selection and the hold, with whether it is still in force.
export async function readHelperStatus(directory: string) {
  const hold = await readHold(directory);
  return { ...await readStatus(directory), hold: hold && { ...hold, active: !!activeHold(hold) } };
}

let writing = Promise.resolve();

// Core's changes one at a time, so concurrent checks and extractions don't drop each other's.
export function updateStatus(directory: string, change: (status: HelperStatus) => void) {
  writing = writing.then(async () => {
    const status = await readStatus(directory);
    change(status);
    await writeJson(join(directory, "status.json"), status);
  }).catch((error: Error) => console.error(`Couch helpers: couldn't record the helpers' status: ${error.message}`));
  return writing;
}
