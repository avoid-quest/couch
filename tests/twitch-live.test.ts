import { afterEach, expect, test } from "bun:test";
import { liveTwitchChannels } from "../src/server/providers/twitch";
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
