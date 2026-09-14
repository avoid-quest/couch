export const diagnosticLimits = { recentEntries: 80, retentionDays: 7, historyBytes: 64 * 1024, messageCharacters: 500, exportBytes: 128 * 1024, snapshotSeconds: 5, helperSeconds: 300 };
const removed = "[redacted]";

// Never preserve URLs, including apparently public ones. Credentials can also
// live in path segments and arbitrary signed query names.
export function redactDiagnosticText(value: unknown, secrets: readonly string[] = [], maximum = diagnosticLimits.messageCharacters): string {
  let text = String(value ?? "");
  if (text.length > 16_384) return "[Diagnostic text exceeded its input limit]";
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, removed).replaceAll(encodeURIComponent(secret), removed);
  text = text
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)/gi, removed)
    .replace(/\b(?:https?|wss?|rtsps?|rtmps?|ftp|smb|nfs|file)%3a%2f%2f[^\r\n]*/gi, "[URL removed]")
    .replace(/\b(?:https?|wss?|rtsps?|rtmps?|ftp|smb|nfs|file):\/\/[^\r\n]*/gi, "[URL removed]")
    .replace(/\b(?:authorization|proxy-authorization|set-cookie|cookie)["']?\s*[:=][^\r\n]*/gi, removed)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.~-]+/gi, removed)
    .replace(/(["']?\b(?:[\w-]*(?:token|password|passwd|secret|credential|api[-_]?key|pairing[-_]?code|recovery[-_]?code)[\w-]*|pwd)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, `$1${removed}`)
    .replace(/\b\d{10}\b/g, removed)
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, removed)
    .replace(/\b(?=[A-Za-z0-9_+/-]{24,}\b)(?=[A-Za-z0-9_+/-]*\d)(?=[A-Za-z0-9_+/-]*[A-Za-z])[A-Za-z0-9_+/-]{24,}\b/g, removed)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}
