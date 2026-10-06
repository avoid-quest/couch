const hostOf = (url = "") => { try { return new URL(url).hostname; } catch { return "unknown"; } };

export function safePlaybackError(message: string, limit = 300) {
  // Controls and Unicode separators can occur inside a reported URL; consume
  // them before flattening the line so a signed suffix cannot survive redaction.
  return message.replace(/\bhttps?:\/\/[^ ]+/gi, url => hostOf(url)).replace(/[\p{Cc}\u2028\u2029]/gu, " ").slice(0, limit);
}

// Renderer reports and Core's FFmpeg failures share the same privacy boundary.
export function logPlaybackError(id: string, where: string, source: string | undefined, message: string) {
  console.log(`${new Date().toISOString()} player error ${id.slice(0, 8)} ${where} host=${hostOf(source)}: ${safePlaybackError(message)}`.replace(/[\p{Cc}\u2028\u2029]/gu, " "));
}
