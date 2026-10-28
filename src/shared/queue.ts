import type { SessionState } from "./protocol";

type QueueState = Pick<SessionState, "queue" | "currentEntryId" | "queueCursorEntryId">;

/** Playing takes precedence; after Stop, the cursor keeps played entries out of Up next. */
export function queueCursorIndex(state: QueueState) {
  const current = state.queue.findIndex(entry => entry.id === state.currentEntryId);
  return current >= 0 ? current : state.queue.findIndex(entry => entry.id === state.queueCursorEntryId);
}

export function upcomingQueue(state: QueueState | null | undefined) {
  return state ? state.queue.slice(queueCursorIndex(state) + 1) : [];
}
