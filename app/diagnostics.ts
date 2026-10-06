import { safePlaybackError } from "../src/server/playback-log";

export const diagnosticHost = (source: string) => { try { return new URL(source).hostname || "unknown"; } catch { return "unknown"; } };

// Like Core's playback evidence, URLs contribute only their host. Consume embedded
// controls/separators before removing them, so a signed URL's suffix stays private.
function safeMessage(value: unknown) {
  const message = String(value instanceof Error ? value.message : value)
    .replace(/\b(?!https?:)[a-z][a-z\d+.-]*:\/\/[^ ]+/gi, diagnosticHost)
    .replace(/\b(?:data|blob):[^ ]+/gi, "[url]")
    .replace(/\b(?:authorization|cookie|set-cookie)\s*[:=][\s\S]*/gi, "[credentials]")
    .replace(/\bBearer\s+[^ ]+/gi, "[credentials]")
    .replace(/\b(?:password|passwd|token|secret|api[-_]?key|signature|sig|credentials?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^ ]+)/gi, "[credentials]");
  // Redact the complete HTTP URL before bounding or flattening other app details.
  return safePlaybackError(message, Infinity)
    .replace(/(?:[a-z]:\\|\\\\|\.{0,2}\/)[^ ]+/gi, "[path]")
    .slice(0, 300);
}

export function appDiagnostic(component: "main" | "renderer" | "update", level: "info" | "warning" | "error", message: unknown) {
  return `${new Date().toISOString()} ${component} ${level}: ${safeMessage(message)}`;
}

export function logAppError(component: "main" | "renderer" | "update", message: unknown) {
  console.error(appDiagnostic(component, "error", message));
}
