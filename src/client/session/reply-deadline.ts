import type { Action } from "../../shared/protocol";

// How long a command waits for Core's reply. Core answers Publish once its encoder
// starts, which the first time may wait for an FFmpeg download within the helper's
// own limits; a lost connection or Cancel still ends it, so it has no deadline here.
export const replyDeadline = (action: Action) => action.type === "publishLive" ? undefined
  : (action.type === "enqueueProvider" && action.shape === "playlist") || action.type === "videoQuality" ? 35_000 : 8_000;
