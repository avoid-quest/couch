import * as Sentry from "@sentry/node";
import { sentryDsn, sentryOptions, setReportingEnabled, tracedApiPaths } from "../shared/sentry";

// Couch handles a failed playback itself, so it never reaches Sentry as an uncaught error.
// A Device's name stays out, and each media host gets its own issue.
export function reportPlaybackFailure(where: string, host: string, message: string) {
  // The one message that names a Device is the page's own (renderer.ts), in its local name.
  const text = message.replace(
    /^.* can't play this format\./s,
    "This device can't play this format.",
  );
  Sentry.captureMessage(text, {
    level: "error",
    tags: { failure: where.startsWith("on ") ? "device" : where, host },
    fingerprint: ["{{ default }}", host],
  });
}

export function setCoreReporting(enabled: boolean) {
  setReportingEnabled(Sentry.getClient(), enabled, startCoreMonitoring);
}

function startCoreMonitoring() {
  const dsn = process.env.COUCH_SENTRY_CORE_DSN ?? sentryDsn;
  if (!dsn) return;
  Sentry.init({
    ...sentryOptions,
    dsn,
    includeServerName: false,
    tracePropagationTargets: [],
    integrations: (defaults) => [
      ...defaults.filter((i) => i.name !== "ProcessSession"),
      Sentry.rewriteFramesIntegration(),
      Sentry.nodeContextIntegration({ device: false, culture: false, cloudResource: false }),
      Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
      Sentry.nativeNodeFetchIntegration({ ignoreOutgoingRequests: () => true }),
      Sentry.httpIntegration({
        sessions: false,
        ignoreOutgoingRequests: () => true,
        ignoreIncomingRequests: (path) => !tracedApiPaths.has(path),
      }),
    ],
  });
}
