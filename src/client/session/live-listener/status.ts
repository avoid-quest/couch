import type { LiveListenerStatus } from "../../../shared/protocol";
import type { LiveReception } from "../session";

/** One status line in the player and Where it plays; local connection failures take precedence. */
export function liveListenerStatus(listener?: LiveListenerStatus, local?: LiveReception): string {
  switch (local?.status.state) {
    case "needs-https": return `Live needs the HTTPS address: ${local.httpsAddress}`;
    case "removed": return "Removed by the host";
    case "failed": return local.status.reason;
    case "reconnecting": return "Reconnecting…";
    case "needs-tap": return "Preparing audio…";
    case "preparing": return "Preparing audio…";
  }
  if (listener?.status === "removed") return "Removed by the host";
  if (listener?.status === "stale") return "Reconnecting…";
  if (listener?.status === "warming") return "Preparing audio…";
  if (listener?.behindMs != null && listener.behindMs > 0) return `Behind by ${Math.ceil(listener.behindMs)} ms`;
  return "";
}
