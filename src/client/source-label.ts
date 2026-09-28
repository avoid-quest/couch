export function sourceLabel(source: string) {
  try {
    if (source.startsWith("web:")) return new URL(source.slice(4)).host;
    const url = new URL(source);
    if (url.protocol === "iptv:") return "Live TV";
    if (url.protocol === "radio:") return "Radio";
    return url.host || "Media";
  } catch { return "Media"; }
}
