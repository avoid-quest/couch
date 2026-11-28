import type { Action, Output, PlaybackSummary, SessionState } from "../../shared/protocol";

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
  return { started, replaced, restore };
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
  for (const { playbackId, outputs } of plan.restore)
    await command({ type: "restoreOutputs", playbackId, outputs });
}
