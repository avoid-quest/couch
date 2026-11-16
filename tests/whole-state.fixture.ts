import { createSessionParts } from "../src/shared/session-parts";
import type { Output, ServerMessage, SessionState } from "../src/shared/protocol";

// Core sends a window three parts; a test reads the whole state they make, as a window does.
const parts = new WeakMap<object, ReturnType<typeof createSessionParts>>();
export function withState(
  socket: object,
  message: ServerMessage,
): ServerMessage | { type: "state"; state: SessionState } {
  if (!parts.has(socket)) parts.set(socket, createSessionParts());
  const state = parts.get(socket)!(message);
  return state ? { type: "state", state } : message;
}

// Where each output plays, without its receiver state, which moves on its own.
export const routes = (outputs: Output[] | undefined) =>
  outputs?.map(({ state: _state, ...output }) => output);
