import type { SessionState } from "../../../shared/protocol";
import type { SettingsPage } from "../../../shared/settings-pages";
import { couchApp } from "../../session/native-context";
import type { UpdateState } from "../../../shared/updates";

export const updateStatuses: Record<UpdateState["status"], string> = { idle: "Not checked yet", checking: "Checking…", "up-to-date": "Up to date", downloading: "Downloading…", ready: "Update ready", installing: "Installing…", error: "Update failed" };
export const updateBusy = (state?: UpdateState) => !!state && ["checking", "downloading", "installing"].includes(state.status);
export const updateReady = (state?: UpdateState) => state?.status === "ready" && !!state.available;
/** The one Updates page each viewer gets: an admin updates the Couch's apps, anyone else only this app; a browser has none. */
export const updatesPage = (administrator: boolean): SettingsPage | null => administrator ? "updates" : couchApp?.updates ? "device-updates" : null;
export const activePlayback = (status: string) => ["loading", "playing", "paused"].includes(status);

/** A server restart affects every playback, not only the one this viewer controls. */
export function updateInterrupts(state: (Pick<SessionState, "playbacks" | "outputs" | "liveSources"> & { player: Pick<SessionState["player"], "status"> }) | null | undefined, ids: string[], viewer: string, localHost = false) {
  if (!state) return false;
  if (!ids.length) return false;
  const all = ids.includes("host") || localHost && ids.includes("app");
  const devices = ids.map(id => id === "app" ? viewer : id);
  if (state.liveSources?.some(source => all || devices.includes(source.deviceId))) return true;
  const playbacks = state.playbacks ?? [{ status: state.player.status, outputs: state.outputs }];
  return playbacks.some(playback => activePlayback(playback.status) && (all || !playback.outputs || playback.outputs.some(output => devices.includes(output.deviceId))));
}

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The TV's last root update (app/update.ts), or null where the system doesn't update Couch on its own. */
export function automaticUpdateStatus({ version, automatic }: UpdateState): string | null {
  if (!automatic) return null;
  if (!automatic.installed) return "Run sudo couch-setup --tv once to turn on automatic updates.";
  if (automatic.active === false) return "Automatic updates are off. You can still update and restart here.";
  const last = automatic.last;
  if (!last) return null;
  const release = last.version ?? "The update";
  const skipped = last.failed ?? last.version;
  return last.outcome === "installed" || last.outcome === "installed-unverified" ? `Updated to ${release} on ${when(last.at)}`
    : last.outcome === "rolled-back" ? `${release} didn't start, so the TV went back to ${version}`
    : last.outcome === "failed" ? `${release} didn't install on ${when(last.at)}${last.error ? `: ${last.error}` : ""}`
    : last.outcome === "waiting" ? "Waiting while media is playing. Automatic updates will check again on the next run."
    : last.outcome === "skipped" ? `Skipped ${skipped ? `Couch ${skipped}` : "a known failed version"} because it failed before. Waiting for a newer release.`
    : `Up to date. Checked ${when(last.at)}`;
}

/** When this app's downloaded update installs without the Update button; only this app can say. */
export function updateInstallHint(state: UpdateState, local: boolean): string | null {
  if (state.status !== "ready" || !local) return null;
  return `Couch ${state.available} ${!state.automatic ? "installs when you quit Couch."
    : state.automatic.installed === false || state.automatic.active === false ? "is ready. Restart to update."
    : state.automatic.last?.failed === state.available ? "didn't start last time, so it only installs when you restart to update."
    : "installs automatically overnight when nothing is playing."}`;
}
