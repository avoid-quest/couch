import type { SessionState } from "../../../shared/protocol";
import type { UpdateState } from "../../../shared/updates";

export const updateStatuses: Record<UpdateState["status"], string> = { idle: "Not checked yet", checking: "Checking…", "up-to-date": "Up to date", downloading: "Downloading…", ready: "Update ready", installing: "Installing…", error: "Update failed" };
export const updateBusy = (state?: UpdateState) => !!state && ["checking", "downloading", "installing"].includes(state.status);
export const updateReady = (state?: UpdateState) => state?.status === "ready" && !!state.available;
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

export const updateNoticeKey = (viewer: string, installation: string, target: string, version: string) =>
  `couch.update-notice:${JSON.stringify([viewer, installation, target, version])}`;
