import { redact } from "../../packaging/tv/redact.js";
import type { ErrorEvent } from "@sentry/react";
import { version } from "../../package.json";
import { frontendPaths } from "./page-paths";

declare const COUCH_SENTRY_DSN: string;
declare const COUCH_SENTRY_ENVIRONMENT: string;

export const sentryDsn = typeof COUCH_SENTRY_DSN === "undefined" ? "" : COUCH_SENTRY_DSN;
const environment =
  typeof COUCH_SENTRY_ENVIRONMENT === "undefined" ? "development" : COUCH_SENTRY_ENVIRONMENT;

// Trace fixed Core endpoints. An unknown /api/ path can itself be a media title or credential.
export const tracedApiPaths = new Set([
  "/api/appearance",
  "/api/artwork",
  "/api/autoplay",
  "/api/bluetooth",
  "/api/build",
  "/api/connection",
  "/api/devices",
  "/api/display",
  "/api/for-later",
  "/api/health",
  "/api/hidden",
  "/api/playback-preview",
  "/api/playlists",
  "/api/profiles",
  "/api/settings",
  "/api/sound",
  "/api/subtitles",
  "/api/updates",
  "/api/ws",
]);

function spanRoute(value: string) {
  return value.replace(/(^|\s)((?:https?:\/\/|\/).*)/i, (_match, prefix: string, url: string) => {
    const path =
      url
        .replace(/^https?:\/\/[^/?#]*/i, "")
        .split(/[?#]/, 1)[0]
        ?.replace(/\/$/, "") || "/";
    return (
      prefix + (frontendPaths.includes(path) || tracedApiPaths.has(path) ? path : "[Filtered]")
    );
  });
}

export const sentryOptions = {
  environment,
  release: `couch@${version}`,
  tracesSampleRate: environment === "development" ? 1 : 0.1,
  // Pairing codes, private media URLs and host tokens can occur in requests and console output.
  maxBreadcrumbs: 0,
  sendClientReports: false,
  beforeSend<T extends Pick<ErrorEvent, "request" | "message" | "exception">>(event: T) {
    delete event.request;
    if (event.message) event.message = redact(event.message);
    for (const error of event.exception?.values ?? []) {
      if (error.value) error.value = redact(error.value);
    }
    return event;
  },
  beforeSendSpan<T extends { name: string; attributes: Record<string, unknown> }>(span: T) {
    span.name = spanRoute(span.name);
    for (const [key, value] of Object.entries(span.attributes)) {
      if (
        key.endsWith(".address") ||
        key.endsWith(".port") ||
        key === "url.fragment" ||
        key === "url.query" ||
        key === "user_agent.original"
      )
        delete span.attributes[key];
      else if (typeof value === "string") span.attributes[key] = spanRoute(value);
    }
    return span;
  },
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    stackFrameVariables: false,
    databaseQueryData: false,
  },
};

// Delay initialization until the first opt-in. Disable delivery before draining SDK buffers.
export function setReportingEnabled(
  client:
    | {
        getOptions(): { enabled?: boolean; sampleRate?: number; tracesSampleRate?: number };
        flush(): PromiseLike<boolean>;
      }
    | undefined,
  enabled: boolean,
  start: () => void,
) {
  if (!client) {
    if (enabled) start();
    return;
  }
  const options = client.getOptions();
  if ((options.enabled !== false) === enabled) return;
  options.enabled = enabled;
  options.sampleRate = enabled ? 1 : 0;
  options.tracesSampleRate = enabled ? sentryOptions.tracesSampleRate : 0;
  if (!enabled) void client.flush();
}
