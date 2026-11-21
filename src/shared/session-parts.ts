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
    else {
      // A clock message moves the Playback's anchor; a later part must not bring back an older one.
      if (message.type === "clock" && playback?.player.playbackId === message.playbackId)
        playback = {
          ...playback,
          player: { ...playback.player, position: message.position, duration: message.duration },
          positionAt: message.at,
        };
      return null;
    }
    return couch && playback && outputs ? { ...playback, ...couch, outputs } : null;
  };
}
