import * as Sentry from "@sentry/react";
import { isReportingEnabled, subscribeReporting } from "./error-reporting";
import { sentryDsn, sentryOptions, setReportingEnabled } from "../shared/sentry";
import { router } from "./router";

function startClientMonitoring() {
  if (!sentryDsn) return;
  Sentry.init({
    ...sentryOptions,
    dsn: sentryDsn,
    transportOptions: { fetchOptions: { referrerPolicy: "no-referrer" } },
    integrations: (defaults) => [
      Sentry.rewriteFramesIntegration({ root: `${location.origin}/` }),
      ...defaults.filter((i) => i.name !== "BrowserSession" && i.name !== "CultureContext"),
      Sentry.tanstackRouterBrowserTracingIntegration(router, {
        traceFetch: false,
        traceXHR: false,
      }),
    ],
    // The player loads private media and artwork directly from providers.
    ignoreSpans: [{ op: /^resource\./ }],
    tracePropagationTargets: [],
  });
  Sentry.logger.info("Couch client started");
}

function updateReporting() {
  setReportingEnabled(Sentry.getClient(), isReportingEnabled(), startClientMonitoring);
}
subscribeReporting(updateReporting);
updateReporting();

export const reactErrorOptions = sentryDsn
  ? {
      onCaughtError: Sentry.reactErrorHandler(console.error),
      onRecoverableError: Sentry.reactErrorHandler(console.error),
      onUncaughtError: Sentry.reactErrorHandler(console.error),
    }
  : undefined;
