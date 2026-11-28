import { host, redact } from "../packaging/tv/redact.js";
import { scrub } from "../src/shared/sentry";

// Main's log shares `couch-session diagnose`'s privacy rule, as Core's playback
// evidence does: URLs contribute only their host.
export const diagnosticHost: (source: string) => string = host;

export function appDiagnostic(
  component: "main" | "renderer" | "update",
  level: "info" | "warning" | "error",
  message: unknown,
) {
  return `${new Date().toISOString()} ${component} ${level}: ${redact(message)}`;
}

// Set by app/sentry.ts: @sentry/electron can't load in the unit tests that import this file and update.ts.
let report: ((component: "main" | "update", message: string) => void) | undefined;
export const reportAppErrors = (reporter: typeof report) => {
  report = reporter;
};

// The page reports its own errors to Sentry, with this device's consent.
export function logAppError(component: "main" | "renderer" | "update", message: unknown) {
  console.error(appDiagnostic(component, "error", message));
  if (component !== "renderer") report?.(component, scrub(message));
}
