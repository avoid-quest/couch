const hostOf = (url = "") => { try { return new URL(url).hostname; } catch { return "unknown"; } };
const sourceHosts = (message: string) => message.replace(/\bhttps?:\/\/[^ ]+/gi, url => hostOf(url));

export function safePlaybackError(message: string, limit = 300) {
  // Controls and Unicode separators can occur inside a reported URL; consume
  // them before flattening the line so a signed suffix cannot survive redaction.
  return sourceHosts(message).replace(/[\p{Cc}\u2028\u2029]/gu, " ").slice(0, limit);
}

/** Bounded FFmpeg diagnostics: redact complete source tokens before selecting lines. */
export function ffmpegErrorLog() {
  let log = "", partial = "", token = "", discarding = false;
  const append = (text: string, final = false) => {
    if (discarding) {
      const end = text.indexOf(" ");
      if (end < 0) return;
      text = text.slice(end); discarding = false;
    }
    const pending = token + text;
    const end = final ? pending.length : pending.lastIndexOf(" ") + 1;
    token = pending.slice(end);
    let safe = sourceHosts(pending.slice(0, end));
    // A source may span writes and contain line breaks. Keep its context until
    // a space or EOF; oversized tokens are discarded whole, never truncated.
    if (token.length > 4000) { token = ""; discarding = true; safe += "[diagnostic omitted]"; }
    const lines = (partial + safe).split("\n");
    partial = lines.pop()!.slice(-4000);
    for (const line of lines) {
      if (!line.includes("Parsed_ashowinfo")) log = (log + line + "\n").slice(-4000);
    }
  };
  return {
    write: (text: string) => append(text),
    last: () => { append("", true); return safePlaybackError((log + partial).trim().split("\n").at(-1) ?? "", 200); },
  };
}

// Renderer reports and Core's FFmpeg failures share the same privacy boundary.
export function logPlaybackError(id: string, where: string, source: string | undefined, message: string) {
  console.log(`${new Date().toISOString()} player error ${id.slice(0, 8)} ${where} host=${hostOf(source)}: ${safePlaybackError(message)}`.replace(/[\p{Cc}\u2028\u2029]/gu, " "));
}
