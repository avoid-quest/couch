// The one privacy rule for what Couch writes about itself: Main's log lines
// (app/diagnostics.ts) and `couch-session diagnose` (packaging/tv). Plain
// JavaScript, as the TV runs it from /usr/share/couch/tv beside the app.
export const host = source => { try { return new URL(source).hostname || "unknown"; } catch { return "unknown"; } };

// URLs keep only their host; credentials, paths and hardware addresses go;
// controls and separators are flattened and the text is bounded. Embedded
// controls/separators are consumed before they're removed, so a signed URL's
// suffix stays private.
export function redact(value, limit = 300) {
  return String(value instanceof Error ? value.message : value)
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^ ]+/gi, host)
    .replace(/\b(?:data|blob):[^ ]+/gi, "[url]")
    .replace(/\b(?:authorization|cookie|set-cookie)(?:\\?["'])?\s*[:=][\s\S]*/gi, "[credentials]")
    .replace(/\bBearer\s+[^ ]+/gi, "[credentials]")
    // Any key naming a credential (access_token, x-api-key), as `key=value`, `key: value` or
    // JSON, with its whole quoted value. Updater HTTP descriptions JSON-escape quotes once more.
    .replace(/\b[\w-]*(?:password|passwd|token|secret|key|signature|sig|credentials?)(?:\\?["'])?\s*[:=]\s*(?:\\"(?:\\\\(?:\\["\\]|[^"\\])|[^\\])*\\"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^ ]+)/gi, "[credentials]")
    // Native paths may contain quotes too; consume through the last closing quote.
    .replace(/(["'])(?:[a-z]:\\|\\\\|~?\/|\.{1,2}\/)[\s\S]*\1/gi, "[path]")
    // An unquoted path has no reliable boundary before the message ends.
    .replace(/(?:[a-z]:\\|\\\\|~?\/|\.{1,2}\/)[\s\S]+/gi, "[path]")
    .replace(/\b(?:[\da-f]{2}[:_-]){5}[\da-f]{2}\b/gi, "[address]")
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .slice(0, limit);
}
