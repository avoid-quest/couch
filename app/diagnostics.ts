import { host, redact } from "../packaging/tv/redact.js";

// Main's log shares `couch-session diagnose`'s privacy rule, as Core's playback
// evidence does: URLs contribute only their host.
export const diagnosticHost: (source: string) => string = host;

export function appDiagnostic(component: "main" | "renderer" | "update", level: "info" | "warning" | "error", message: unknown) {
  return `${new Date().toISOString()} ${component} ${level}: ${redact(message)}`;
}

export function logAppError(component: "main" | "renderer" | "update", message: unknown) {
  console.error(appDiagnostic(component, "error", message));
}
