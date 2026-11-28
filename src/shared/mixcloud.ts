import type { MediaShape } from "./media";

/** A Mixcloud page: a mix (atom), a user's uploads or one playlist (playlist), or a user's playlists (a page to open). */
export type MixcloudLink = {
  provider: "mixcloud";
  shape: MediaShape | "page";
  kind: "mix" | "user" | "playlists" | "playlist";
  /** The canonical page, `https://www.mixcloud.com/<user>/…/` as Mixcloud's API spells it. */
  url: string;
  /** The page's path on api.mixcloud.com, which mirrors the site's. */
  path: string;
};

export const mixcloudOrigin = "https://www.mixcloud.com";
const hosts = ["mixcloud.com", "www.mixcloud.com", "m.mixcloud.com"];
// Site sections, not users; and a user's tabs that aren't mixes.
const sections = new Set([
  "about",
  "categories",
  "dashboard",
  "developers",
  "discover",
  "live",
  "pro",
  "search",
  "select",
  "settings",
  "tag",
  "upload",
  "widget",
]);
const tabs = new Set([
  "activity",
  "favorites",
  "followers",
  "following",
  "hosts",
  "listens",
  "reposts",
  "stream",
  "stats",
]);
const user = /^[A-Za-z0-9_-]{1,64}$/;
const slug = /^[A-Za-z0-9_.~%-]{1,300}$/;

export const isMixcloudHost = (host: string) => hosts.includes(host);

/** What a Mixcloud link is, from the link alone. */
export function mixcloudLink(value: string): MixcloudLink | undefined {
  if (value.length > 2048) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !isMixcloudHost(url.hostname)
  )
    return;
  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, second, third] = parts;
  if (!owner || !user.test(owner) || sections.has(owner.toLowerCase()) || parts.length > 3) return;
  const page = (kind: MixcloudLink["kind"], path: string): MixcloudLink => ({
    provider: "mixcloud",
    shape: kind === "mix" ? "atom" : kind === "playlists" ? "page" : "playlist",
    kind,
    url: `${mixcloudOrigin}${path}`,
    path,
  });
  if (!second || (second === "uploads" && !third)) return page("user", `/${owner}/`);
  if (second === "playlists")
    return !third
      ? page("playlists", `/${owner}/playlists/`)
      : slug.test(third)
        ? page("playlist", `/${owner}/playlists/${third}/`)
        : undefined;
  if (third || tabs.has(second) || !slug.test(second)) return;
  return page("mix", `/${owner}/${second}/`);
}
