import type { Action, Output, PlaybackSummary, SessionState } from "../../shared/protocol";
import { restoringByUndo } from "./undo";

// What made way for a change that takes devices (Play on, Move here, a device's Sound or Picture key, a group), so its
// Undo puts back only what the change did: the Playback it started stops, an item it replaced in a device's own Playback
// plays again from where it was, every Playback it took channels from gets those back, and what it paused plays again.
// Core does it all or nothing, and refuses once a device the change moved is elsewhere.

type Channels = Pick<Output, "deviceId" | "picture" | "sound">;
type Undo = Extract<Action, { type: "restoreOutputs" }>;
export type MadeWay = {
  undo: Undo;
  /** The Playback this window controlled before, which it controls again. */
  controlled?: string;
};

const channels = (outputs: Output[]) =>
  outputs
    .filter((output) => output.picture || output.sound)
    .map(({ deviceId, picture, sound }) => ({ deviceId, picture, sound }));
// Where a device is in a state: the Playback whose mix it is in, a held publisher included, and its channels.
const placeOf = (playbacks: PlaybackSummary[], deviceId: string) => {
  for (const playback of playbacks) {
    const output = [...channels(playback.outputs), ...(playback.held ? [playback.held] : [])].find(
      (item) => item.deviceId === deviceId,
    );
    if (output)
      return { deviceId, playbackId: playback.id, picture: output.picture, sound: output.sound };
  }
  return { deviceId, playbackId: null, picture: false, sound: false };
};
const off = (deviceId: string): Channels => ({ deviceId, picture: false, sound: false });
// The channels of one Playback the change changed, as they were before it.
const changes = (before: PlaybackSummary, after: PlaybackSummary) => {
  const was = channels(before.outputs),
    now = channels(after.outputs);
  return [...new Set([...was, ...now].map((output) => output.deviceId))].flatMap((id) => {
    const then = was.find((output) => output.deviceId === id) ?? off(id),
      next = now.find((output) => output.deviceId === id) ?? off(id);
    return then.picture === next.picture && then.sound === next.sound ? [] : [then];
  });
};

/**
 * The plan from the states before and after the change, as this window saw them: the Playback it controls after Play
 * on is the one Play on started or reused.
 */
export function madeWay(before: SessionState, after: SessionState, played = false): MadeWay {
  const playbacks = after.playbacks ?? [];
  const was = new Map((before.playbacks ?? []).map((playback) => [playback.id, playback]));
  const now = new Map(playbacks.map((playback) => [playback.id, playback]));
  const target = after.playback ?? undefined;
  const startedId = played && target && !was.has(target) ? target : undefined;
  const started =
    startedId && after.currentEntryId
      ? { playbackId: startedId, entryId: after.currentEntryId }
      : undefined;
  // Play on that kept a device's own Playback started its item there: the item before it is the one it replaced.
  const reused = played && target && was.has(target) ? was.get(target) : undefined;
  const index = after.queue.findIndex((entry) => entry.id === after.currentEntryId);
  const previous = index > 0 ? after.queue[index - 1] : undefined;
  const replaced =
    reused && previous && after.currentEntryId && previous.title === reused.title
      ? { playbackId: reused.id, entryId: previous.id, newEntryId: after.currentEntryId }
      : undefined;
  const restore = [...was.values()].flatMap((playback) => {
    const next = now.get(playback.id);
    if (!next || playback.id === startedId || playback.status === "idle" || playback.private)
      return [];
    const outputs = changes(playback, next);
    // Move here lets go of a publisher held for its own capture, which Undo holds again.
    const held = playback.held && !next.held ? playback.held.deviceId : undefined;
    return outputs.length || held
      ? [{ playbackId: playback.id, outputs, ...(held ? { held } : {}) }]
      : [];
  });
  const moved = new Set([
    ...restore.flatMap((item) => [
      ...item.outputs.map((output) => output.deviceId),
      ...(item.held ? [item.held] : []),
    ]),
    ...(started ? channels(now.get(started.playbackId)?.outputs ?? []) : []).map(
      (output) => output.deviceId,
    ),
  ]);
  const resume = [...was.values()]
    .filter(
      (playback) =>
        playback.id !== startedId &&
        playback.status === "playing" &&
        !playback.private &&
        now.get(playback.id)?.status === "paused",
    )
    .map((playback) => playback.id);
  return {
    undo: {
      type: "restoreOutputs",
      left: [...moved].map((id) => placeOf(playbacks, id)),
      ...(started ? { started } : {}),
      ...(replaced ? { replaced } : {}),
      restore,
      resume,
    },
    controlled: before.playback ?? undefined,
  };
}

/** The plan has something to undo. */
export const hasUndo = ({ undo }: MadeWay) =>
  !!(undo.started || undo.replaced || undo.restore.length);

/** Undo, which Core does all at once; then this window controls again what it controlled before. */
export async function undoMadeWay(
  plan: MadeWay,
  command: (action: Action) => Promise<unknown>,
  current: () => SessionState | null,
) {
  restoringByUndo();
  await command(plan.undo);
  if (plan.controlled && current()?.playback !== plan.controlled)
    await command({ type: "selectPlayback", playbackId: plan.controlled }).catch(() => {});
}
