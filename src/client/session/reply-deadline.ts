import type { Action } from "../../shared/protocol";

// How long a command waits for Core's reply.
export const replyDeadline = (action: Action) => (action.type === "enqueueProvider" && action.shape === "playlist") || action.type === "videoQuality" ? 35_000 : 8_000;
