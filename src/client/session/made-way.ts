import type { Action, Output, PlaybackSummary, SessionState } from "../../shared/protocol";
import { restoringByUndo } from "./undo";

// What made way for a change that takes devices (Play on, Move here, a device's Sound or Picture key), so its Undo puts
// everything back: the Playback it started stops, an item it replaced in a device's own Playback plays again from
// where it was, and every Playback it changed has its devices again, a paused one waiting for a device included.

type Channels = Pick<Output, "deviceId" | "picture" | "sound">;
export type MadeWay = {
  /** A Playback the change started, which Undo stops. */
  started?: string;
  /** The item Play on replaced in a device's own Playback, which plays again (Core resumes its place). */
  replaced?: { entryId: string; newEntryId: string };
  /** Each Playback the change touched, with the devices it had. */
  restore: { playbackId: string; outputs: Channels[] }[];
  /** Playbacks that played before and were paused by the change, which play again. */
  resume: string[];
  /** The Playback this window controlled before, which it controls again. */
  controlled?: string;
};

const channels = (outputs: Output[]) =>
  outputs
    .filter((output) => output.picture || output.sound)
    .map(({ deviceId, picture, sound }) => ({ deviceId, picture, sound }));
const key = (outputs: Channels[]) =>
  outputs
    .map((output) => `${output.deviceId}:${+output.picture}${+output.sound}`)
    .sort()
    .join(" ");
const changed = (before: PlaybackSummary, after: PlaybackSummary | undefined) =>
  !!after && key(channels(before.outputs)) !== key(channels(after.outputs));

/**
 * The plan from the states before and after the change, as this window saw them: the Playback it controls after Play
 * on is the one Play on started or reused.
 */
export function madeWay(before: SessionState, after: SessionState, played = false): MadeWay {
  const was = new Map((before.playbacks ?? []).map((playback) => [playback.id, playback]));
  const now = new Map((after.playbacks ?? []).map((playback) => [playback.id, playback]));
  const target = after.playback ?? undefined;
  const started = played && target && !was.has(target) ? target : undefined;
  // Play on that kept a device's own Playback started its item there: the item before it is the one it replaced.
  const reused = played && target && was.has(target) ? was.get(target) : undefined;
  const index = after.queue.findIndex((entry) => entry.id === after.currentEntryId);
  const previous = index > 0 ? after.queue[index - 1] : undefined;
  const replaced =
    reused && previous && after.currentEntryId && previous.title === reused.title
      ? { entryId: previous.id, newEntryId: after.currentEntryId }
      : undefined;
  const restore = [...was.values()]
    .filter(
      (playback) =>
        playback.id !== started &&
        playback.status !== "idle" &&
        !playback.private &&
        changed(playback, now.get(playback.id)),
    )
    .map((playback) => ({ playbackId: playback.id, outputs: channels(playback.outputs) }));
  const resume = [...was.values()]
    .filter(
      (playback) =>
        playback.id !== started &&
        playback.status === "playing" &&
        !playback.private &&
        now.get(playback.id)?.status === "paused",
    )
    .map((playback) => playback.id);
  return { started, replaced, restore, resume, controlled: before.playback ?? undefined };
}

/**
 * Undo, in an order that never leaves a Playback without a device: what started stops first. Stop acts on the Playback
 * this window controls, so the started one is chosen first if another was since.
 */
export async function undoMadeWay(
  plan: MadeWay,
  command: (action: Action) => Promise<unknown>,
  current: () => SessionState | null,
) {
  if (plan.started) {
    if (current()?.playback !== plan.started)
      await command({ type: "selectPlayback", playbackId: plan.started });
    await command({ type: "stop" });
  }
  if (plan.replaced) {
    await command({ type: "play", entryId: plan.replaced.entryId });
    await command({ type: "remove", entryId: plan.replaced.newEntryId });
  }
  restoringByUndo();
  for (const { playbackId, outputs } of plan.restore)
    await command({ type: "restoreOutputs", playbackId, outputs });
  // Play and Pause name the item that plays, which this window learns once it controls that Playback.
  for (const id of plan.resume) {
    await command({ type: "selectPlayback", playbackId: id });
    const playing = await controls(current, id);
    if (playing) await command({ type: "pause", playbackId: playing, paused: false });
  }
  if (plan.controlled && current()?.playback !== plan.controlled)
    await command({ type: "selectPlayback", playbackId: plan.controlled }).catch(() => {});
}

/** The item this window's controlled Playback `id` plays, once its state says so (Core answers within moments). */
async function controls(current: () => SessionState | null, id: string) {
  for (let tries = 0; tries < 40; tries++) {
    const state = current();
    if (state?.playback === id && state.player.playbackId) return state.player.playbackId;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}
