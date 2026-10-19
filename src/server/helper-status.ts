import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
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
const helpers: Helper[] = ["yt-dlp", "qjs", "ffmpeg", "mpv"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : null;

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

// Flushes a rename or removal in this directory to disk. Windows can't open a directory to
// flush it; there NTFS's journal records the rename.
async function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

// Written and flushed beside the file, then renamed over it and the rename flushed, so a
// reader never sees half of it and a power cut after this returns keeps the new version.
export async function writeJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.tmp`;
  const created = await mkdir(dirname(file), { recursive: true });
  if (created) await syncDirectory(dirname(created));
  const handle = await open(temporary, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, file);
  await syncDirectory(dirname(file));
}

// The status as recorded, keeping only entries of the expected shape: a damaged record
// loses its history but never stops Core choosing a helper.
export async function readStatus(directory: string): Promise<HelperStatus> {
  const value = await readJson(join(directory, "status.json"));
  const status = empty();
  if (!isRecord(value) || value.schema !== 1) return status;
  const { selected, managed } = value;
  for (const name of helpers) {
    const choice = isRecord(selected) ? selected[name] : null;
    if (isRecord(choice) && (choice.origin === "system" || choice.origin === "managed") && typeof choice.version === "string"
      && typeof choice.path === "string" && typeof choice.verifiedAt === "string" && typeof choice.held === "boolean")
      status.selected[name] = { origin: choice.origin, version: choice.version, path: choice.path, sha256: text(choice.sha256), verifiedAt: choice.verifiedAt, latest: text(choice.latest), held: choice.held };
    const copies = isRecord(managed) ? managed[name] : null;
    if (isRecord(copies)) status.managed[name] = Object.fromEntries(Object.entries(copies).flatMap(([version, copy]): Array<[string, ManagedCopy]> => isRecord(copy) ? [[version, {
      sha256: text(copy.sha256), installedAt: text(copy.installedAt),
      worked: isRecord(copy.worked) ? Object.fromEntries(Object.entries(copy.worked).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
    }]] : []));
  }
  return status;
}

export async function readHold(directory: string): Promise<HelperHold | null> {
  const hold = await readJson(join(directory, "hold.json"));
  if (!isRecord(hold) || hold.schema !== 1 || hold.helper !== "yt-dlp") return null;
  const { version, since, until } = hold;
  return typeof version === "string" && typeof since === "string" && typeof until === "string" && !Number.isNaN(Date.parse(until))
    ? { schema: 1, helper: "yt-dlp", version, since, until } : null;
}

export const activeHold = (hold: HelperHold | null) => hold && Date.parse(hold.until) > Date.now() ? hold : null;

export async function removeHold(directory: string) {
  await rm(join(directory, "hold.json"), { force: true });
  // Nothing to flush when Couch has no helpers directory yet.
  await syncDirectory(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}

// `--helpers previous` pins the copy it checks, in <data>/helpers/pins, so a running Core keeps
// that copy until the hold is written. Each command has its own pin; one a stopped command left
// lapses after ten minutes.
export async function pin(directory: string, version: string) {
  const file = join(directory, "pins", `${process.pid}-${randomUUID()}.json`);
  await writeJson(file, { version, until: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  return () => rm(file, { force: true });
}

// The pinned versions. Lapsed or damaged pins are removed; one still being written is skipped.
export async function pinned(directory: string) {
  const pins = join(directory, "pins"), versions = new Set<string>();
  for (const entry of await readdir(pins).catch(() => [])) {
    if (entry.endsWith(".tmp")) continue;
    const value = await readJson(join(pins, entry));
    if (isRecord(value) && typeof value.version === "string" && typeof value.until === "string" && Date.parse(value.until) > Date.now()) versions.add(value.version);
    else await rm(join(pins, entry), { force: true }).catch(() => {});
  }
  return versions;
}

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
