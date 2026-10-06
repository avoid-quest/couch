const hostOf = (url = "") => { try { return new URL(url).hostname; } catch { return "unknown"; } };

// Renderer reports and Core's FFmpeg failures share the same privacy boundary.
export function logPlaybackError(id: string, where: string, source: string | undefined, message: string) {
  const safe = message.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, url => hostOf(url)).slice(0, 300);
  console.log(`${new Date().toISOString()} player error ${id.slice(0, 8)} ${where} host=${hostOf(source)}: ${safe}`.replace(/[\p{Cc}\u2028\u2029]/gu, " "));
}
