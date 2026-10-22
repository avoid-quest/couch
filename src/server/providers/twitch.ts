import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import { ProviderError, providerItemId, providerJson, withProviderItem } from "./http";

// Twitch publishes this web client ID in its public HTML. The Kodi add-on also
// uses it for account-free catalog search; it is not an OAuth token.
// https://github.com/anxdpanic/plugin.video.twitch/blob/v3.0.3/resources/lib/twitch_addon/addon/gql_search.py
const endpoint = "https://gql.twitch.tv/gql";
const clientId = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const channelFields = "login displayName description profileImageURL(width:300)";
const streamFields = "id title viewersCount previewImageURL(width:640,height:360) game { name }";
const streamEdges = `edges { node { ${streamFields} broadcaster { ${channelFields} } } }`;
const categoryFields = "name slug boxArtURL(width:285,height:380) viewersCount";
const loginPattern = /^[a-z\d_]{1,25}$/i;
const categoryPattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}-]{0,199}$/u;
const cursorPattern = /^[a-z\d+/]{1,510}={0,2}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum = 200) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const unavailable = () => new ProviderError("Twitch's public catalog is unavailable. Try again shortly.");

function thumbnail(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "static-cdn.jtvnw.net" && !url.username && !url.password && !url.port ? url.href : undefined;
  } catch { return undefined; }
}

function viewers(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? `${value.toLocaleString("en-US")} viewers` : "";
}

function channel(value: unknown): ProviderItem | null {
  if (!object(value) || typeof value.login !== "string" || !loginPattern.test(value.login)) return null;
  if (value.stream !== null && (!object(value.stream) || typeof value.stream.id !== "string" || !/^\d+$/.test(value.stream.id))) return null;
  const stream = object(value.stream) ? value.stream : null;
  const game = stream && object(stream.game) ? text(stream.game.name) : "";
  const url = `https://www.twitch.tv/${value.login.toLowerCase()}`;
  return {
    id: providerItemId("twitch", url), provider: "twitch", kind: stream ? "media" : "channel", url,
    title: text(value.displayName) || value.login, live: Boolean(stream),
    thumbnail: thumbnail(stream?.previewImageURL) ?? thumbnail(value.profileImageURL),
    description: text(stream?.title ?? value.description, 2000),
    subtitle: stream ? [game, viewers(stream.viewersCount)].filter(Boolean).join(" · ") : "Offline",
  };
}

function video(value: unknown): ProviderItem | null {
  if (!object(value) || typeof value.id !== "string" || !/^\d{1,20}$/.test(value.id) || !text(value.title)) return null;
  const url = `https://www.twitch.tv/videos/${value.id}`;
  const date = typeof value.publishedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value.publishedAt) ? value.publishedAt.slice(0, 10) : "";
  return {
    id: providerItemId("twitch", url), provider: "twitch", kind: "media", url,
    title: text(value.title), live: false, thumbnail: thumbnail(value.previewThumbnailURL),
    subtitle: ["Past broadcast", date].filter(Boolean).join(" · "),
    ...(typeof value.lengthSeconds === "number" && Number.isSafeInteger(value.lengthSeconds) && value.lengthSeconds > 0 ? { duration: value.lengthSeconds } : {}),
  };
}

function category(value: unknown): ProviderItem | null {
  if (!object(value) || typeof value.slug !== "string" || !categoryPattern.test(value.slug) || !text(value.name)) return null;
  const url = `https://www.twitch.tv/directory/category/${encodeURIComponent(value.slug)}`;
  return {
    id: providerItemId("twitch", url), provider: "twitch", kind: "collection", url,
    title: text(value.name), thumbnail: thumbnail(value.boxArtURL), subtitle: viewers(value.viewersCount),
  };
}

function items(connection: unknown, map: (value: unknown) => ProviderItem | null, field: "node" | "item" = "node") {
  if (!object(connection) || !Array.isArray(connection.edges)) throw unavailable();
  const mapped = connection.edges.slice(0, 50).flatMap(edge => {
    const item = object(edge) ? map(edge[field]) : null;
    return item ? [item] : [];
  });
  return [...new Map(mapped.map(item => [item.id, item])).values()];
}

const streamItem = (value: unknown) => object(value) && object(value.broadcaster) ? channel({ ...value.broadcaster, stream: value }) : null;

async function query(document: string, variables: Record<string, unknown>, signal?: AbortSignal) {
  const value = await providerJson(endpoint, {
    method: "POST", credentials: "omit", signal,
    headers: { "Client-ID": clientId, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: document, variables }),
  });
  // A challenge or GraphQL failure is an upstream error, never an offline channel.
  if (!object(value) || !object(value.data) || (Array.isArray(value.errors) && value.errors.length)) throw unavailable();
  return value.data;
}

function destination(input: string) {
  try {
    if (input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input)) throw new Error();
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || !["twitch.tv", "www.twitch.tv", "m.twitch.tv"].includes(url.hostname)
      || url.username || url.password || url.port) throw new Error();
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    if (!path || path === "/directory/all") return { kind: "live" } as const;
    if (["/directory", "/directory/categories"].includes(path)) return { kind: "categories" } as const;
    const slug = path.startsWith("/directory/category/") ? path.slice("/directory/category/".length) : "";
    if (categoryPattern.test(slug)) return { kind: "category", slug } as const;
    const login = path.slice(1).replace(/\/videos$/, "");
    if (loginPattern.test(login) && !["directory", "videos", "search", "settings", "downloads", "login", "signup", "subscriptions"].includes(login.toLowerCase())) {
      return { kind: "channel", login: login.toLowerCase() } as const;
    }
  } catch { /* Only catalog routes become variables in requests to the fixed endpoint. */ }
  throw new ProviderError("Enter a Twitch channel or category URL.", 400);
}

export async function browseTwitch(request: BrowseRequest, signal?: AbortSignal): Promise<ProviderPage> {
  signal?.throwIfAborted();
  const search = request.query?.trim() ?? "";
  if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search)) throw new ProviderError("Use a Twitch search of up to 200 characters.", 400);
  // Live-directory pagination can require a browser integrity challenge. Search
  // pagination uses the public site's SearchForOptions and works without login.
  if (request.cursor && (!search || !cursorPattern.test(request.cursor))) throw new ProviderError("Search for a channel or choose a Twitch category to narrow the results.", 400);
  if (search && request.url) throw new ProviderError("Search Twitch or enter a channel URL, one at a time.", 400);
  if (search) {
    const data = await query(`query Search($q:String!,$options:SearchForOptions) { searchFor(userQuery:$q,platform:"web",options:$options) { channels { cursor pageInfo { hasNextPage } edges { item { ... on User { ${channelFields} stream { ${streamFields} } } } } } } }`, {
      q: search, options: { targets: [{ index: "CHANNEL", limit: 20, ...(request.cursor ? { cursor: request.cursor } : {}) }] },
    }, signal);
    if (!object(data.searchFor)) throw unavailable();
    const connection = data.searchFor.channels;
    const results = items(connection, channel, "item");
    const nextCursor = results.length && object(connection) && object(connection.pageInfo) && connection.pageInfo.hasNextPage === true
      && typeof connection.cursor === "string" && cursorPattern.test(connection.cursor) && connection.cursor !== request.cursor ? connection.cursor : undefined;
    return { title: `Twitch: ${search}`, items: results, ...(nextCursor ? { nextCursor } : {}) };
  }
  const target = request.url ? destination(request.url) : { kind: "live" } as const;
  if (target.kind === "channel") {
    // Archive cursors trigger Twitch integrity checks. Request recent broadcasts
    // in one bounded public query rather than offering pagination that fails.
    const data = await query(`query Channel($login:String!) { user(login:$login) { ${channelFields} stream { ${streamFields} } videos(first:50,type:ARCHIVE,sort:TIME) { edges { node { id title lengthSeconds previewThumbnailURL(width:640,height:360) publishedAt } } } } }`, { login: target.login }, signal);
    if (data.user === null) throw new ProviderError("Twitch channel not found.", 404);
    const item = channel(data.user);
    if (!item || !object(data.user)) throw unavailable();
    const broadcasts = items(data.user.videos, video).map(broadcast => ({...broadcast, creator: {title: item.title, url: item.url}}));
    return withProviderItem("twitch", item.url, "channel", { title: item.title, thumbnail: item.thumbnail, description: item.description, subtitle: item.subtitle, items: [item, ...broadcasts] });
  }
  if (target.kind === "categories") {
    const data = await query(`{ games(first:20) { edges { node { ${categoryFields} } } } }`, {}, signal);
    return withProviderItem("twitch", "https://www.twitch.tv/directory", "collection", { title: "Twitch categories", items: items(data.games, category) });
  }
  if (target.kind === "category") {
    const data = await query(`query Category($slug:String!) { game(slug:$slug) { name streams(first:20) { ${streamEdges} } } }`, { slug: target.slug }, signal);
    if (data.game === null) throw new ProviderError("Twitch category not found.", 404);
    if (!object(data.game)) throw unavailable();
    return withProviderItem("twitch", `https://www.twitch.tv/directory/category/${encodeURIComponent(target.slug)}`, "collection", { title: text(data.game.name) || target.slug, items: items(data.game.streams, streamItem) });
  }
  const data = await query(`{ streams(first:20) { ${streamEdges} } }`, {}, signal);
  const page: ProviderPage = { title: "Live on Twitch", items: items(data.streams, streamItem) };
  return request.url ? withProviderItem("twitch", "https://www.twitch.tv/directory/all", "collection", page) : page;
}

const savedLogin = (item: ProviderItem) => item.provider === "twitch" && item.kind === "channel" ? /^https:\/\/www\.twitch\.tv\/([a-z\d_]{1,25})$/.exec(item.url)?.[1] : undefined;

/**
 * Whether saved channels are live now, in a public query per 100 channels: a saved channel keeps the "Offline" it was
 * saved with otherwise. Returns each answered channel's live state and subtitle by URL.
 */
export async function liveTwitchChannels(items: ProviderItem[], signal?: AbortSignal): Promise<Map<string, Pick<ProviderItem, "live" | "subtitle">>> {
  const logins = [...new Set(items.flatMap(item => savedLogin(item) ?? []))];
  const now = new Map<string, Pick<ProviderItem, "live" | "subtitle">>();
  const batches = Array.from({ length: Math.ceil(logins.length / 100) }, (_, index) => logins.slice(index * 100, index * 100 + 100));
  const answers = await Promise.all(batches.map(logins => query("query Live($logins:[String!]) { users(logins:$logins) { login stream { id viewersCount game { name } } } }", { logins }, signal)));
  for (const user of answers.flatMap(data => Array.isArray(data.users) ? data.users : [])) {
    if (!object(user) || typeof user.login !== "string" || !loginPattern.test(user.login)) continue;
    const stream = object(user.stream) ? user.stream : null;
    const game = stream && object(stream.game) ? text(stream.game.name) : "";
    now.set(`https://www.twitch.tv/${user.login.toLowerCase()}`, { live: !!stream, subtitle: stream ? [game, viewers(stream.viewersCount)].filter(Boolean).join(" · ") : "Offline" });
  }
  return now;
}
