import type { Output, ServerMessage, SessionState } from "./protocol";

/**
 * Core sends each window three parts that change apart: the Couch, the Playback it looks at, and that
 * Playback's outputs. This keeps the latest of each and gives the whole state once all three arrived.
 */
export function createSessionParts() {
  let couch: Extract<ServerMessage, { type: "couch" }>["couch"] | undefined;
  let playback: Extract<ServerMessage, { type: "playback" }>["playback"] | undefined;
  let outputs: Output[] | undefined;
  return (message: ServerMessage): SessionState | null => {
    if (message.type === "couch") couch = message.couch;
    else if (message.type === "playback") playback = message.playback;
    else if (message.type === "outputs") outputs = message.outputs;
    else return null;
    return couch && playback && outputs ? { ...playback, ...couch, outputs } : null;
  };
}
