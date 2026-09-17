import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import { createProviders } from "./index";
import { ProviderError, providerItemId } from "./http";

const catalogs: ReturnType<typeof createProviders>[] = [];
const directories: string[] = [];
const item: ProviderItem = { id: "client-supplied-id", provider: "youtube", kind: "media", title: "A video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", description: "First line\nSecond line", subtitle: "Channel\tname" };
const api = (path: string, body?: unknown) => new Request(`http://localhost/api/providers/${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function fixture(options: Partial<Parameters<typeof createProviders>[0]> = {}) {
  const catalog = createProviders({ databasePath: ":memory:", ...options });
  catalogs.push(catalog);
  return catalog;
}
afterEach(() => {
  for (const catalog of catalogs.splice(0)) catalog.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("favorites persist multiline descriptions, compute stable IDs, and invalidate shared catalogs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-providers-"));
  directories.push(directory);
  const databasePath = join(directory, "state.sqlite");
  let changes = 0;
  const catalog = fixture({ databasePath, onChange: () => changes++ });
  const response = await catalog.handle(api("favorites", { item }));
  const saved = { ...item, id: providerItemId(item.provider, item.url) };
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ item: saved });
  expect(changes).toBe(1);
  catalog.close();
  const restarted = fixture({ databasePath, onChange: () => changes++ });
  expect(await (await restarted.handle(api("favorites"))).json()).toEqual({ favorites: [saved] });
  for (let attempt = 0; attempt < 2; attempt++) expect((await restarted.handle(new Request(`http://localhost/api/providers/favorites/${saved.id}`, { method: "DELETE" }))).status).toBe(204);
  expect(changes).toBe(2);
  expect(await (await restarted.handle(api("favorites"))).json()).toEqual({ favorites: [] });
});

test("drag reordering persists favorite positions across restarts and rejects stale orders", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-providers-order-"));
  directories.push(directory);
  const databasePath = join(directory, "state.sqlite");
  const catalog = fixture({ databasePath });
  const first = (await (await catalog.handle(api("favorites", { item: { ...item, title: "First", url: "https://www.youtube.com/watch?v=first" } }))).json() as { item: ProviderItem }).item;
  const second = (await (await catalog.handle(api("favorites", { item: { ...item, title: "Second", url: "https://www.youtube.com/watch?v=second" } }))).json() as { item: ProviderItem }).item;
  // New saves lead the list, so the saved order is second, first.
  expect(await (await catalog.handle(api("favorites"))).json()).toEqual({ favorites: [second, first] });
  expect((await catalog.handle(api("favorites/reorder", { order: [first.id, second.id] }))).status).toBe(200);
  expect(await (await catalog.handle(api("favorites"))).json()).toEqual({ favorites: [first, second] });
  catalog.close();
  const restarted = fixture({ databasePath });
  expect(await (await restarted.handle(api("favorites"))).json()).toEqual({ favorites: [first, second] });
  expect((await restarted.handle(api("favorites/reorder", { order: [first.id, first.id] }))).status).toBe(400);
  expect((await restarted.handle(api("favorites/reorder", { order: [first.id, "gone"] }))).status).toBe(409);
  expect((await restarted.handle(new Request("http://localhost/api/providers/favorites/reorder"))).status).toBe(405);
  expect(await (await restarted.handle(api("favorites"))).json()).toEqual({ favorites: [first, second] });
});

test("favorites installed before reordering keep their newest-first reading order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-providers-migrate-"));
  directories.push(directory);
  const databasePath = join(directory, "state.sqlite");
  const legacy = new Database(databasePath, { create: true, strict: true });
  legacy.run("CREATE TABLE provider_favorites (id TEXT PRIMARY KEY, item TEXT NOT NULL)");
  const older = { ...item, title: "Older", url: "https://www.youtube.com/watch?v=older", id: providerItemId(item.provider, "https://www.youtube.com/watch?v=older") };
  const newer = { ...item, title: "Newer", url: "https://www.youtube.com/watch?v=newer", id: providerItemId(item.provider, "https://www.youtube.com/watch?v=newer") };
  legacy.query("INSERT INTO provider_favorites VALUES ('older', ?)").run(JSON.stringify(older));
  legacy.query("INSERT INTO provider_favorites VALUES ('newer', ?)").run(JSON.stringify(newer));
  legacy.close();
  const catalog = fixture({ databasePath });
  expect(await (await catalog.handle(api("favorites"))).json()).toEqual({ favorites: [newer, older] });
});

test("favorites reject foreign provider URLs, invalid metadata and wrong methods", async () => {
  const catalog = fixture();
  for (const invalid of [
    { ...item, url: "https://youtube.com.attacker.example/video" },
    { ...item, url: "https://username:password@youtube.com/video" },
    { ...item, title: "a".repeat(201) },
    { ...item, description: "invalid\u0000text" },
    { ...item, thumbnail: "file:///etc/passwd" },
    { ...item, live: "true" },
  ]) expect((await catalog.handle(api("favorites", { item: invalid }))).status).toBe(400);
  const wrong = await catalog.handle(api("youtube/items", {}));
  expect(wrong.status).toBe(405);
  expect(wrong.headers.get("Allow")).toBe("GET");
});

test("browse caches complete pages by provider, query and cursor and retries failures", async () => {
  const requests: BrowseRequest[] = [];
  const browse = async (request: BrowseRequest): Promise<ProviderPage> => {
    requests.push(request);
    if (request.query === "failure") throw new ProviderError("Try again", 503);
    return { items: [item], nextCursor: "24" };
  };
  const catalog = fixture({ browse: { youtube: browse, twitch: browse, raiplay: browse, bandcamp: browse, streamingcommunity: browse } });
  for (let attempt = 0; attempt < 2; attempt++) expect((await catalog.handle(api("youtube/items?q=music"))).status).toBe(200);
  expect(requests).toEqual([{ query: "music" }]);
  await catalog.handle(api("youtube/items?q=music&cursor=24"));
  await catalog.handle(api("twitch/items?q=music"));
  expect(requests.length).toBe(3);
  for (let attempt = 0; attempt < 2; attempt++) expect((await catalog.handle(api("youtube/items?q=failure"))).status).toBe(503);
  expect(requests.length).toBe(5);
});

test("browse bounds parallel work, forwards cancellation and aborts requests on close", async () => {
  const signals: AbortSignal[] = [];
  const browse = (_: BrowseRequest, signal?: AbortSignal) => new Promise<ProviderPage>((_, reject) => {
    signals.push(signal!);
    signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
  });
  const catalog = fixture({ browse: { youtube: browse, twitch: browse, raiplay: browse, bandcamp: browse, streamingcommunity: browse } });
  const controller = new AbortController();
  const pending = [catalog.handle(new Request("http://localhost/api/providers/youtube/items?q=first", { signal: controller.signal }))];
  for (let i = 1; i < 6; i++) pending.push(catalog.handle(api(`youtube/items?q=${i}`)));
  expect((await catalog.handle(api("youtube/items?q=overflow"))).status).toBe(503);
  controller.abort();
  await pending[0];
  expect(signals[0]!.aborted).toBe(true);
  pending.push(catalog.handle(api("youtube/items?q=replacement")));
  expect(signals.length).toBe(7);
  catalog.close();
  await Promise.all(pending);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect((await catalog.handle(api("favorites"))).status).toBe(503);
});
