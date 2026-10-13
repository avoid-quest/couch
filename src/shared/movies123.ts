export const movies123Origin = "https://ww8.123moviesfree.net";

export const isMovies123Host = (hostname: string) => /^(?:(?:www|ww\d{1,3})\.)?123moviesfree\.net$/i.test(hostname);

// The site selects episodes with buttons. Couch keeps the number in its public
// page reference and removes it before fetching the season page.
export function movies123PageUrl(value: string): URL | undefined {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !isMovies123Host(url.hostname) || url.port || url.username || url.password || url.hash) return;
    const match = /^\/(movie|season)\/([a-z0-9][a-z0-9-]*-[1-9]\d{0,11})\/?$/.exec(url.pathname);
    if (!match || match[2]!.length > 220 || url.search && (match[1] !== "season" || !/^\?episode=[1-9]\d{0,2}$/.test(url.search) || Number(url.searchParams.get("episode")) > 500)) return;
    url.protocol = "https:";
    url.pathname = `/${match[1]}/${match[2]}/`;
    return url;
  } catch { return; }
}
