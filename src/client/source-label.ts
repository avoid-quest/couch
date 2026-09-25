export function sourceLabel(source: string) {
  try {
    if (source.startsWith("web:")) return new URL(source.slice(4)).host;
    const url = new URL(source);
    if (url.protocol === "file:") return "Local file";
    if (url.protocol === "library:") return "Your library";
    if (url.protocol === "jellyfin:") return "Jellyfin";
    if (url.protocol === "iptv:") return "TV guide";
    if (url.protocol === "radio:") return "Radio playlist";
    return url.host || "Media";
  } catch { return "Media"; }
}
