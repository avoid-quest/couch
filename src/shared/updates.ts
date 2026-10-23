// Couch's native update contract, shared by Main, Core and remote renderers.
// "latest" is Stable, matching electron-updater's feed name.
const channels = ["latest", "preview"] as const;
const statuses = ["idle", "checking", "up-to-date", "downloading", "ready", "installing", "error"] as const;
const outcomes = ["installed", "installed-unverified", "rolled-back", "failed", "skipped", "up-to-date", "waiting"] as const;

export type UpdateChannel = typeof channels[number];
export type UpdateAction = { op: "read" } | { op: "check" } | { op: "channel"; channel: UpdateChannel } | { op: "install"; version: string; interrupt?: boolean };
export const UPDATE_INTERRUPTS_PLAYBACK = "Updating will stop playback. Choose Stop playback and update to continue.";
export type UpdateTarget = { id: string; name: string; tv: boolean };
export type UpdateOutcome = {
  version: string | null;
  outcome: typeof outcomes[number];
  at: number;
  error: string | null;
  // Older apps omit the release that failed to start, which the timer skips.
  failed?: string | null;
};
export type UpdateState = {
  version: string;
  channel: UpdateChannel;
  status: typeof statuses[number];
  // The version found, while it downloads, waits or installs.
  available: string | null;
  progress: number | null;
  checkedAt: number | null;
  error: string | null;
  // The TV's root updates and last run (/var/lib/couch-update/status).
  automatic?: { installed: boolean; active?: boolean; last: UpdateOutcome | null };
};

export const isUpdateChannel = (value: unknown): value is UpdateChannel => channels.includes(value as UpdateChannel);
export const isUpdateVersion = (value: unknown): value is string => typeof value === "string" && value.length <= 80 && /^\d+\.\d+\.\d+(-preview\.\d+)?$/.test(value);
const isOutcome = (value: unknown): value is UpdateOutcome["outcome"] => outcomes.includes(value as UpdateOutcome["outcome"]);
const isError = (value: unknown) => value === null || typeof value === "string" && value.length <= 4096;
const isTime = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const isRelease = (value: unknown) => value === null || isUpdateVersion(value);

export function validateUpdateAction(action: unknown): asserts action is UpdateAction {
  if (!action || typeof action !== "object" || Array.isArray(action) || !("op" in action)) throw new Error("Invalid update action.");
  if (action.op === "read" || action.op === "check") return;
  if (action.op === "channel") {
    if (!("channel" in action) || !isUpdateChannel(action.channel)) throw new Error("Choose Stable or Preview.");
  } else if (action.op === "install") {
    if (!("version" in action) || !isUpdateVersion(action.version)) throw new Error("Choose the available update.");
    if ("interrupt" in action && typeof action.interrupt !== "boolean") throw new Error("Choose whether to stop playback.");
  } else throw new Error("Invalid update action.");
}

function isUpdateOutcome(value: unknown): value is UpdateOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const last = value as UpdateOutcome;
  return isRelease(last.version) && isOutcome(last.outcome) && isTime(last.at) && isError(last.error)
    && (last.failed === undefined || isRelease(last.failed));
}

export function isUpdateState(value: unknown): value is UpdateState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as UpdateState;
  return isUpdateVersion(state.version) && isUpdateChannel(state.channel) && statuses.includes(state.status)
    && isRelease(state.available) && isError(state.error)
    && (state.progress === null || typeof state.progress === "number" && Number.isFinite(state.progress) && state.progress >= 0 && state.progress <= 100)
    && (state.checkedAt === null || isTime(state.checkedAt))
    && (state.automatic === undefined || state.automatic !== null && typeof state.automatic === "object" && !Array.isArray(state.automatic)
      && typeof state.automatic.installed === "boolean" && (state.automatic.active === undefined || typeof state.automatic.active === "boolean")
      && (state.automatic.last === null || isUpdateOutcome(state.automatic.last)));
}

// KEY=value lines written by the TV updater. Missing/garbled releases stay null.
export function parseUpdateOutcome(text: string): UpdateOutcome | null {
  const fields = Object.fromEntries([...text.matchAll(/^(\w+)=(.*)$/gm)].map(([, key, value]) => [key, value]));
  const at = Date.parse(fields.at ?? "");
  if (!isOutcome(fields.outcome) || !isTime(at)) return null;
  return { version: isUpdateVersion(fields.version) ? fields.version : null, outcome: fields.outcome, at,
    error: fields.error?.trim().slice(0, 4096) || null, failed: isUpdateVersion(fields.failed) ? fields.failed : null };
}
