import { safePlaybackError } from "../src/server/playback-log";

export const diagnosticHost = (source: string) => { try { return new URL(source).hostname || "unknown"; } catch { return "unknown"; } };

// Like Core's playback evidence, URLs contribute only their host. Consume embedded
// controls/separators before removing them, so a signed URL's suffix stays private.
function safeMessage(value: unknown) {
  const message = String(value instanceof Error ? value.message : value)
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^ ]+/gi, diagnosticHost)
    .replace(/\b(?:data|blob):[^ ]+/gi, "[url]")
    .replace(/\b(?:authorization|cookie|set-cookie)(?:\\?["'])?\s*[:=][\s\S]*/gi, "[credentials]")
    .replace(/\bBearer\s+[^ ]+/gi, "[credentials]")
    // Updater HTTP descriptions JSON-escape their quoted fields once more.
    .replace(/\b(?:password|passwd|token|secret|api[-_]?key|signature|sig|credentials?)(?:\\?["'])?\s*[:=]\s*(?:\\"(?:\\\\(?:\\["\\]|[^"\\])|[^\\])*\\"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^ ]+)/gi, "[credentials]")
    // Keep quoted spaces and raw controls inside the path until it is removed.
    .replace(/(["'])(?:[a-z]:\\|\\\\|\.{0,2}\/)[\s\S]*?\1/gi, "[path]")
    .replace(/(?:[a-z]:\\|\\\\|\.{0,2}\/)[^ ]+/gi, "[path]");
  return safePlaybackError(message);
}

export function appDiagnostic(component: "main" | "renderer" | "update", level: "info" | "warning" | "error", message: unknown) {
  return `${new Date().toISOString()} ${component} ${level}: ${safeMessage(message)}`;
}

export function logAppError(component: "main" | "renderer" | "update", message: unknown) {
  console.error(appDiagnostic(component, "error", message));
}
