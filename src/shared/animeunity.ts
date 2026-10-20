// Public references keep their original identity across transport domain moves.
export const animeUnityOrigin = "https://www.animeunity.so";

// Keep saved links from before the domain move usable.
export const isAnimeUnityHost = (hostname: string) => /^(?:www\.)?animeunity\.[a-z]{2,63}$/i.test(hostname);

// The final ID is the site's episode ID, not its displayed episode number.
export function animeUnityPageUrl(value: string): URL | undefined {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !isAnimeUnityHost(url.hostname) || url.port || url.username || url.password || url.search || url.hash) return;
    const match = /^\/anime\/([1-9]\d{0,11}-[a-z0-9][a-z0-9-]{0,219})(?:\/([1-9]\d{0,11}))?\/?$/.exec(url.pathname);
    if (!match) return;
    return new URL(`/anime/${match[1]}${match[2] ? `/${match[2]}` : ""}`, animeUnityOrigin);
  } catch { return; }
}
