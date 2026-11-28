import type { Action, SessionState } from "../../shared/protocol";
import { keepsProgress } from "../../shared/viewing";

type Resume = {
  entryId: string;
  playbackId: string | null;
  position: number;
  paused: boolean;
  seekable: boolean;
} | null;

export type UndoPlan =
  | { text: string; stoppedId: string; removed?: never }
  | {
      text: string;
      expectedCurrent: string | null;
      expectedQueueIds: string[];
      resume: Resume;
      removed: { entryIds: string[]; token: string; beforeEntryId: string | null };
    };

function resume(state: SessionState): Resume {
  return state.currentEntryId && ["loading", "playing", "paused"].includes(state.player.status)
    ? {
        entryId: state.currentEntryId,
        playbackId: state.player.playbackId,
        position: state.player.position,
        paused: state.player.status === "paused",
        seekable: state.player.seekable,
      }
    : null;
}

const names = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * Stop says where it stopped, This device included, and that the item waits in Continue when Core kept its place: media
 * it keeps progress for (keepsProgress), started, and seekable, as Core saves no place it couldn't return to
 * (server/progress.ts). Stopping never marks it watched.
 */
function stopped(before: SessionState, here: string) {
  const ids = [...new Set(before.outputs?.map((output) => output.deviceId) ?? [])];
  const where = ids
    .map((id) =>
      id === here ? "This device" : before.devices?.find((device) => device.id === id)?.name,
    )
    .filter((name): name is string => !!name);
  const entry = before.queue.find((item) => item.id === before.currentEntryId);
  const kept =
    !!entry && keepsProgress(entry) && before.player.seekable && before.player.position > 0;
  return `Stopped${where.length ? ` on ${names.format(where)}` : ""}.${kept ? " It's in Continue." : ""}`;
}

export function undoPlan(
  action: Action,
  before: SessionState,
  after: SessionState,
  here: string,
): UndoPlan | null {
  if (action.type === "stop") {
    const stoppedId = resume(before)?.playbackId;
    return stoppedId && (!action.playbackId || action.playbackId === stoppedId)
      ? { text: stopped(before, here), stoppedId }
      : null;
  }
  if (action.type === "remove") {
    const index = before.queue.findIndex((entry) => entry.id === action.entryId);
    if (
      index < 0 ||
      after.queue.some((entry) => entry.id === action.entryId) ||
      after.queueRemoval?.entryId !== action.entryId
    )
      return null;
    return {
      text: `Removed ${before.queue[index]!.title}.`,
      expectedCurrent: before.currentEntryId === action.entryId ? null : before.currentEntryId,
      expectedQueueIds: after.queue.map((entry) => entry.id),
      resume: before.currentEntryId === action.entryId ? resume(before) : null,
      removed: {
        entryIds: [action.entryId],
        token: after.queueRemoval.token,
        beforeEntryId: before.queue[index + 1]?.id ?? null,
      },
    };
  }
  if (action.type === "clearUpNext") {
    const kept = new Set(after.queue.map((entry) => entry.id));
    const cleared = before.queue.filter((entry) => !kept.has(entry.id)).map((entry) => entry.id);
    if (!cleared.length || !after.queueRemoval || after.queueRemoval.entryId !== cleared[0])
      return null;
    return {
      text: "Cleared Up next.",
      expectedCurrent: before.currentEntryId,
      expectedQueueIds: after.queue.map((entry) => entry.id),
      resume: null,
      removed: { entryIds: cleared, token: after.queueRemoval.token, beforeEntryId: null },
    };
  }
  return null;
}

const ids = (state: SessionState) => state.queue.map((entry) => entry.id);
const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);
const changed = () => new Error("Up next changed. Can't undo.");
function assertCurrent(current: () => SessionState | null, expected: SessionState) {
  const state = current();
  if (
    !state ||
    state.currentEntryId !== expected.currentEntryId ||
    !same(ids(state), ids(expected))
  )
    throw changed();
}

async function observe(
  current: () => SessionState | null,
  beforeQueue: string[],
  beforeCurrent: string | null,
  expectedQueue: string[],
  expectedCurrent: string | null,
) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const state = current();
    if (!state) throw changed();
    if (same(ids(state), expectedQueue) && state.currentEntryId === expectedCurrent) return state;
    if (!same(ids(state), beforeQueue) || state.currentEntryId !== beforeCurrent) throw changed();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Couldn't fully undo.");
}

function reorderedForPlay(state: SessionState, entryId: string) {
  const queue = ids(state);
  const index = queue.indexOf(entryId);
  const cursor = queue.indexOf(state.currentEntryId ?? state.queueCursorEntryId ?? "");
  if (index < 0) throw changed();
  return index > cursor + 1
    ? [
        ...queue.slice(0, cursor + 1),
        entryId,
        ...queue.slice(cursor + 1).filter((id) => id !== entryId),
      ]
    : queue;
}

export async function applyUndo(
  plan: UndoPlan,
  command: (action: Action) => Promise<void>,
  current: () => SessionState | null,
) {
  if ("stoppedId" in plan) return command({ type: "undoStop", stoppedId: plan.stoppedId });
  let state = current();
  if (
    !state ||
    state.currentEntryId !== plan.expectedCurrent ||
    !same(ids(state), plan.expectedQueueIds)
  )
    throw changed();
  const prior = ids(state);
  if (plan.removed.entryIds.some((id) => prior.includes(id))) throw changed();
  const restored = [...prior];
  const before = plan.removed.beforeEntryId
    ? restored.indexOf(plan.removed.beforeEntryId)
    : restored.length;
  if (before < 0) throw changed();
  restored.splice(before, 0, ...plan.removed.entryIds);
  assertCurrent(current, state);
  await command({ type: "restoreRemoved", token: plan.removed.token });
  state = await observe(current, prior, state.currentEntryId, restored, state.currentEntryId);
  if (plan.resume) {
    const nextQueue = reorderedForPlay(state, plan.resume.entryId);
    const priorQueue = ids(state);
    const priorCurrent = state.currentEntryId;
    assertCurrent(current, state);
    await command({ type: "play", entryId: plan.resume.entryId });
    state = await observe(current, priorQueue, priorCurrent, nextQueue, plan.resume.entryId);
    if ((plan.resume.seekable && plan.resume.position > 1) || plan.resume.paused) {
      const deadline = Date.now() + 10_000;
      let player = current()?.player;
      while (
        Date.now() < deadline &&
        (!player?.playbackId ||
          player.playbackId === plan.resume.playbackId ||
          !["playing", "paused"].includes(player.status))
      ) {
        assertCurrent(current, state);
        await new Promise((resolve) => setTimeout(resolve, 100));
        player = current()?.player;
      }
      if (
        player?.playbackId &&
        player.playbackId !== plan.resume.playbackId &&
        ["playing", "paused"].includes(player.status)
      ) {
        assertCurrent(current, state);
        if (plan.resume.seekable && plan.resume.position > 1) {
          if (!player.seekable) throw new Error("Couldn't fully undo.");
          await command({
            type: "seek",
            playbackId: player.playbackId,
            position: plan.resume.position,
          });
        }
        if (plan.resume.paused && player.status !== "paused")
          await command({ type: "pause", playbackId: player.playbackId, paused: true });
      } else throw new Error("Couldn't fully undo.");
    }
  }
}
