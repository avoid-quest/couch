import { afterEach, expect, test } from "bun:test";
import { browseTwitch, liveTwitchChannels } from "../src/server/providers/twitch";
import { createProviders } from "../src/server/providers";
import type { ProviderItem } from "../src/shared/providers";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const channel = (login: string): ProviderItem => ({ id: login, provider: "twitch", kind: "channel", title: login, url: `https://www.twitch.tv/${login}`, subtitle: "Offline", live: false });

test("saved Twitch channels are asked about in one query and say whether they are live now", async () => {
  const asked: unknown[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    asked.push(JSON.parse(String(init.body)).variables);
    return Response.json({ data: { users: [{ login: "live", stream: { id: "1", viewersCount: 1204, game: { name: "Just Chatting" } } }, { login: "asleep", stream: null }] } });
  }) as typeof fetch;
  const now = await liveTwitchChannels([channel("live"), channel("asleep"), { ...channel("other"), provider: "youtube", url: "https://www.youtube.com/@other" }]);
  expect(asked).toEqual([{ logins: ["live", "asleep"] }]);
  expect(now.get("https://www.twitch.tv/live")).toEqual({ live: true, subtitle: "Just Chatting · 1,204 viewers" });
  expect(now.get("https://www.twitch.tv/asleep")).toEqual({ live: false, subtitle: "Offline" });
});

test.each([[0, "0 viewers"], [1, "1 viewer"], [2, "2 viewers"]] as const)("Twitch viewer count %i is consistent across search, categories and saved channels", async (viewersCount, label) => {
  const user = { login: "live", stream: { id: "1", viewersCount, game: { name: "Music" } } };
  const responses = [
    { searchFor: { channels: { edges: [{ item: user }] } } },
    { games: { edges: [{ node: { name: "Music", slug: "music", viewersCount } }] } },
    { users: [user] },
  ];
  globalThis.fetch = (async () => Response.json({ data: responses.shift() })) as unknown as typeof fetch;
  const search = await browseTwitch({ query: "live" });
  const categories = await browseTwitch({ url: "https://www.twitch.tv/directory" });
  const now = await liveTwitchChannels([channel("live")]);
  expect(search.items[0]?.subtitle).toBe(`Music · ${label}`);
  expect(categories.items[0]?.subtitle).toBe(label);
  expect(now.get("https://www.twitch.tv/live")).toEqual({ live: true, subtitle: `Music · ${label}` });
});

test("more than 100 saved Twitch channels are asked about 100 at a time", async () => {
  const asked: string[][] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { logins } = JSON.parse(String(init.body)).variables as { logins: string[] };
    asked.push(logins);
    return Response.json({ data: { users: logins.map(login => ({ login, stream: null })) } });
  }) as typeof fetch;
  const now = await liveTwitchChannels(Array.from({ length: 250 }, (_, index) => channel(`c${index}`)));
  expect(asked.map(logins => logins.length)).toEqual([100, 100, 50]);
  expect(now.get("https://www.twitch.tv/c249")).toEqual({ live: false, subtitle: "Offline" });
});

test("a live channel's page shows its avatar and its row the stream preview", async () => {
  const preview = "https://static-cdn.jtvnw.net/previews-ttv/live_user_live-640x360.jpg";
  const avatar = "https://static-cdn.jtvnw.net/jtv_user_pictures/live-300x300.png";
  globalThis.fetch = (async () => Response.json({ data: { user: {
    login: "live", displayName: "Live", description: "", profileImageURL: avatar,
    stream: { id: "1", title: "Now", viewersCount: 3, previewImageURL: preview, game: { name: "Chess" } }, videos: { edges: [] },
  } } })) as unknown as typeof fetch;
  const page = await browseTwitch({ url: "https://www.twitch.tv/live" });
  expect([page.thumbnail, page.item?.thumbnail, page.items[0]?.thumbnail]).toEqual([avatar, avatar, preview]);
});

test("saved items keep what they were saved with when Twitch doesn't answer, and Twitch is asked once meanwhile", async () => {
  let asked = 0;
  const providers = createProviders({ databasePath: ":memory:", liveChannels: async () => { asked++; throw new Error("Unavailable"); } });
  const post = (item: ProviderItem) => providers.handle(new Request("http://couch/api/providers/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) }));
  const read = async () => (await (await providers.handle(new Request("http://couch/api/providers/favorites"))).json() as { favorites: ProviderItem[] }).favorites;
  await post(channel("asleep"));
  const [favorites] = await Promise.all([read(), read()]);
  await read();
  expect(favorites.map(item => [item.title, item.live, item.subtitle])).toEqual([["asleep", false, "Offline"]]);
  expect(asked).toBe(1);
  providers.close();
});
