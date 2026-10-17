export const animesaturnOrigin = "https://animesaturn.ro";

export const isAnimeSaturnHost = (hostname: string) => /^(?:www\.)?animesaturn\.ro$/i.test(hostname);

/** Public anime and episode pages, never player embeds or signed stream URLs. */
export function animeSaturnPageUrl(value: string): URL | undefined {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !isAnimeSaturnHost(url.hostname) || url.port || url.username || url.password || url.search || url.hash) return;
    const path = url.pathname.replace(/\/$/, "");
    if (path.length > 240 || !/^\/(?:anime\/[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*-(?:episode|episodio|ep)-\d{1,5}(?:-[a-z0-9]+)*)$/.test(path)) return;
    return new URL(`${path}/`, animesaturnOrigin);
  } catch { return; }
}
