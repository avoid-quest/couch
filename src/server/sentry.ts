import * as Sentry from "@sentry/node";
import { sentryDsn, sentryOptions, setReportingEnabled, tracedApiPaths } from "../shared/sentry";

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
