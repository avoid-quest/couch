import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../src/server/sqlite";
import { createYouTubeBrowser, createYouTubePlaylistLoader } from "../src/server/providers/youtube";
import { createProviders } from "../src/server/providers";
import { createForLater } from "../src/server/for-later";
import { providerItemId } from "../src/server/providers/http";
import { providerMetadata } from "../src/server/provider-metadata";
import { createContinuationResolver } from "../src/server/continuation";
import { createSession } from "../src/server/session";
import { openStore } from "../src/server/store";
import { parseCommand } from "../src/server/validation";
import {
  providerCollectionCursor,
  readCollectionSearch,
} from "../src/client/collection-pagination";
import type { BrowseRequest, ProviderItem, ProviderPage } from "../src/shared/providers";
import type { QueueEntry } from "../src/shared/protocol";

const channel = "https://www.youtube.com/channel/UC4eYXhJI4-7wSWc8UNRwD4A";
const alias = "https://www.youtube.com/@nprmusic";
const playlist = "https://www.youtube.com/playlist?list=PLabcdefghijk";
const creator = { title: "NPR Music", url: channel };
const video = (id = "abcdefghijk") => ({
  id,
  title: `Video ${id}`,
  url: `https://www.youtube.com/watch?v=${id}`,
  _type: "url",
});
const rawPage = (entries: unknown[], extra = {}) => ({
  _type: "playlist",
  title: "Fixture playlist",
  webpage_url: playlist,
  playlist_count: entries.length,
  entries,
  ...extra,
});
const runner = (data: unknown) => async () => JSON.stringify(data);
const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (path: string) => new Request(`http://localhost${path}`);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function catalog(
  browse: (request: BrowseRequest, signal?: AbortSignal) => Promise<ProviderPage>,
  databasePath = ":memory:",
) {
  return createProviders({
    databasePath,
    browse: { youtube: browse } as Parameters<typeof createProviders>[0]["browse"],
  });
}
function forLater(providers: ReturnType<typeof createProviders>) {
  return createForLater({
    databasePath: ":memory:",
    onChange() {},
    lookup: async () => {
      throw new Error("unused");
    },
    prepare: async () => {},
    reservePlay: () => 0,
    enqueue() {},
    webMetadata: (url, collection) =>
      providerMetadata(providers.cachedItem(url, collection), !!collection),
  });
}

test("channel aliases and search share one new favorite and canonical section links", async () => {
  const browse = createYouTubeBrowser(async (args) =>
    JSON.stringify(
      args.at(-1)?.includes("/results?")
        ? rawPage([
            {
              url: channel,
              title: channel.split("/").at(-1),
              channel: creator.title,
              channel_url: channel,
            },
          ])
        : { title: "NPR Music", channel: "NPR Music", channel_url: channel, entries: [] },
    ),
  );
  const providers = catalog(browse);
  try {
    const searched = (await browse({ query: "NPR Music" })).items[0]!;
    for (const path of [
      "@nprmusic",
      "c/nprmusic",
      "user/nprmusic",
      "channel/UC4eYXhJI4-7wSWc8UNRwD4A",
    ]) {
      const page = await browse({ url: `https://www.youtube.com/${path}` });
      assert.equal(page.item?.url, channel);
      assert.equal(page.item?.id, searched.id);
      assert.deepEqual(
        page.items.map((item) => item.url),
        ["videos", "playlists", "shorts", "streams"].map((tab) => `${channel}/${tab}`),
      );
      assert.deepEqual(
        page.items.map((item) => item.id),
        page.items.map((item) => providerItemId("youtube", item.url)),
      );
      assert.equal(
        (await providers.handle(post("/api/providers/favorites", { item: page.item }))).status,
        200,
      );
    }
    assert.equal(
      (await providers.handle(post("/api/providers/favorites", { item: searched }))).status,
      200,
    );
    const { favorites } = await (await providers.handle(get("/api/providers/favorites"))).json();
    assert.equal(favorites.length, 1);
    assert.equal(favorites[0].url, channel);
    assert.equal(favorites[0].title, creator.title);
  } finally {
    providers.close();
  }
});

test("failed or unusable channel metadata keeps the requested identity and sections", async () => {
  for (const raw of [
    null,
    "not JSON",
    {},
    { channel_url: alias },
    { channel_url: `${channel}/videos` },
    { channel_url: video().url },
  ]) {
    const page = await createYouTubeBrowser(async () => {
      if (raw === null) throw new Error("metadata unavailable");
      return typeof raw === "string" ? raw : JSON.stringify(raw);
    })({ url: alias });
    assert.equal(page.item?.url, alias);
    assert.equal(page.item?.title, "@nprmusic");
    assert.equal(page.item?.id, providerItemId("youtube", alias));
    assert.ok(page.items.every((item) => item.url.startsWith(`${alias}/`)));
  }
  const controller = new AbortController();
  await assert.rejects(
    createYouTubeBrowser(async () => {
      controller.abort();
      throw controller.signal.reason;
    })({ url: alias }, controller.signal),
    { name: "AbortError" },
  );
});

test("legacy and newly saved ID titles use their known channel name without looking up or rewriting legacy data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-youtube-title-"));
  const databasePath = join(directory, "favorites.sqlite");
  const url = "https://www.youtube.com/channel/UCDKjZ6tnLsoxSEfy0GMsfbw";
  const legacy: ProviderItem = {
    id: providerItemId("youtube", url),
    provider: "youtube",
    kind: "channel",
    url,
    title: "UCDKjZ6tnLsoxSEfy0GMsfbw",
    subtitle: "Sabaku no Pureeyaa",
    thumbnail: "https://yt3.googleusercontent.com/avatar=s900",
  };
  const db = new Database(databasePath);
  db.exec(
    "CREATE TABLE provider_favorites (id TEXT PRIMARY KEY, item TEXT NOT NULL, position INTEGER NOT NULL)",
  );
  db.query("INSERT INTO provider_favorites VALUES (?, ?, ?)").run(
    legacy.id,
    JSON.stringify(legacy),
    7,
  );
  let changes = 0,
    lookups = 0;
  const providers = createProviders({
    databasePath,
    onChange() {
      changes++;
    },
    browse: {
      youtube: async () => {
        lookups++;
        throw new Error("Saved must not browse");
      },
    } as Parameters<typeof createProviders>[0]["browse"],
  });
  const read = async () =>
    (await (await providers.handle(get("/api/providers/favorites"))).json())
      .favorites as ProviderItem[];
  try {
    assert.deepEqual(await read(), [{ ...legacy, title: legacy.subtitle }]);
    assert.equal(
      db
        .query<{ item: string }, [string]>("SELECT item FROM provider_favorites WHERE id = ?")
        .get(legacy.id)?.item,
      JSON.stringify(legacy),
    );
    assert.equal(changes, 0, "reading Saved leaves the stored legacy entry intact");
    assert.equal(lookups, 0, "a known saved name needs no metadata lookup");
    const saved = await providers.handle(post("/api/providers/favorites", { item: legacy }));
    assert.equal((await saved.json()).item.title, legacy.subtitle);
    assert.equal(
      JSON.parse(
        db
          .query<{ item: string }, [string]>("SELECT item FROM provider_favorites WHERE id = ?")
          .get(legacy.id)!.item,
      ).title,
      legacy.subtitle,
    );
    const custom = { ...legacy, title: "My  streams", description: "My note" };
    await providers.handle(post("/api/providers/favorites", { item: custom }));
    assert.deepEqual(await read(), [custom]);
    await providers.handle(
      post("/api/providers/favorites", { item: { ...legacy, subtitle: undefined } }),
    );
    assert.equal(
      (await read())[0]?.title,
      legacy.title,
      "an unknown name keeps the address fallback",
    );
    await providers.handle(
      post("/api/providers/favorites", { item: { ...legacy, kind: "collection" } }),
    );
    assert.equal((await read())[0]?.title, legacy.title, "the fallback applies only to channels");
  } finally {
    providers.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const duplicate of [false, true]) {
  test(`alias migration preserves chosen metadata${duplicate ? " from an existing canonical bookmark" : ""}`, async () => {
    const providers = catalog(
      createYouTubeBrowser(runner({ channel: creator.title, channel_url: channel, entries: [] })),
    );
    const saved: ProviderItem = {
      id: providerItemId("youtube", alias),
      provider: "youtube",
      kind: "channel",
      url: alias,
      title: "My  concerts",
      description: "My note",
      thumbnail: "https://yt3.googleusercontent.com/custom=s900",
    };
    const canonical = {
      ...saved,
      id: providerItemId("youtube", channel),
      url: channel,
      title: "My  music",
      description: "Canonical note",
    };
    const other = {
      ...saved,
      id: providerItemId("youtube", `${alias}-other`),
      url: `${alias}-other`,
    };
    const request = () =>
      get(`/api/providers/youtube/items?${new URLSearchParams({ url: alias })}`);
    const read = async () =>
      (await (await providers.handle(get("/api/providers/favorites"))).json()).favorites;
    try {
      await providers.handle(post("/api/providers/favorites", { item: saved }));
      if (duplicate) await providers.handle(post("/api/providers/favorites", { item: canonical }));
      await providers.handle(post("/api/providers/favorites", { item: other }));
      assert.equal((await providers.handle(request())).status, 200);
      const expected = [
        other,
        duplicate ? canonical : { ...saved, id: canonical.id, url: channel },
      ];
      assert.deepEqual(await read(), expected);
      await providers.handle(request());
      assert.deepEqual(
        await read(),
        expected,
        "cached resolution preserves the same bookmark and order",
      );
      assert.equal(
        (
          await providers.handle(
            new Request(`http://localhost/api/providers/favorites/${canonical.id}`, {
              method: "DELETE",
            }),
          )
        ).status,
        204,
      );
      assert.deepEqual(await read(), [other]);
    } finally {
      providers.close();
    }
  });
}

test("channel videos inherit the verified creator through browse, Save and full-list Queue metadata", async () => {
  const url = `${alias}/videos`;
  const run = runner(
    rawPage([{ ...video(), channel: null, channel_url: null }], {
      webpage_url: url,
      channel: creator.title,
      channel_url: channel,
    }),
  );
  const providers = catalog(createYouTubeBrowser(run));
  const later = forLater(providers);
  try {
    const response = await providers.handle(
      get(`/api/providers/youtube/items?${new URLSearchParams({ url })}`),
    );
    assert.equal(response.status, 200);
    const page = await response.json();
    const item = page.items[0];
    assert.deepEqual(page.parent, creator);
    assert.deepEqual(item.creator, creator);
    assert.equal(item.subtitle, creator.title);
    const saved = await later.handle(
      post("/api/for-later", { reference: { kind: "web", url: item.url, title: item.title } }),
    );
    assert.equal(saved.status, 201);
    assert.deepEqual(
      (await (await later.handle(get("/api/for-later"))).json()).items[0].creator,
      creator,
    );
    const loaded = (await createYouTubePlaylistLoader(run)(url)).items[0]!;
    assert.deepEqual(providerMetadata(loaded).creator, creator);
    assert.equal(loaded.collection, undefined, "channel tabs do not define automatic continuation");
  } finally {
    later.close();
    providers.close();
  }
});

test("entry creators take precedence; playlist and search owners are never inherited", async () => {
  const other = {
    title: "Another channel",
    url: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
  };
  const entries = [
    video(),
    { ...video("bcdefghijkl"), channel: other.title, channel_url: other.url },
  ];
  for (const url of [playlist, `${alias}/videos`, `${alias}/playlists`]) {
    const run = runner(
      rawPage(entries, { webpage_url: url, channel: creator.title, channel_url: channel }),
    );
    const page = await createYouTubeBrowser(run)({ url });
    assert.deepEqual(
      page.items.map((item) => item.creator),
      [url.endsWith("/videos") ? creator : undefined, other],
    );
    if (!url.endsWith("/playlists")) {
      const loaded = await createYouTubePlaylistLoader(run)(url);
      assert.deepEqual(
        loaded.items.map((item) => item.creator),
        page.items.map((item) => item.creator),
      );
    }
  }
  const search = await createYouTubeBrowser(
    runner(rawPage(entries, { channel: creator.title, channel_url: channel })),
  )({ query: "music" });
  assert.deepEqual(
    search.items.map((item) => item.creator),
    [undefined, other],
  );
  const unverified = runner(
    rawPage([video()], {
      webpage_url: `${alias}/videos`,
      channel: creator.title,
      channel_url: playlist,
    }),
  );
  assert.equal(
    (await createYouTubeBrowser(unverified)({ url: `${alias}/videos` })).items[0]?.creator,
    undefined,
  );
  assert.equal(
    (await createYouTubePlaylistLoader(unverified)(`${alias}/videos`)).items[0]?.creator,
    undefined,
  );
});

test("complete playlist contexts preserve duplicate positions and continuation uses the selected occurrence", async () => {
  const load = createYouTubePlaylistLoader(
    runner(rawPage([video(), video("bcdefghijkl"), video(), video("cdefghijklm")])),
  );
  const page = await load(playlist);
  assert.deepEqual(
    page.items.map((item) => item.collection),
    [0, 1, 2, 3].map((index) => ({ title: "Fixture playlist", url: playlist, index })),
  );
  const resolve = createContinuationResolver(async () => page);
  const selected = page.items[2]!;
  const entry = {
    id: "selected",
    source: `web:${selected.url}`,
    title: selected.title,
    collection: selected.collection,
  };
  assert.deepEqual(
    (await resolve(entry, new AbortController().signal))?.entries.map(
      (item) => item.collection?.index,
    ),
    [3],
  );
  assert.equal(
    await resolve(
      { ...entry, collection: { ...selected.collection!, index: 1 } },
      new AbortController().signal,
    ),
    null,
  );
  assert.equal(
    await resolve(
      { ...entry, collection: { title: "Fixture playlist", url: playlist } },
      new AbortController().signal,
    ),
    null,
    "a duplicate needs its occurrence",
  );
});

test("list validation still rejects incomplete, unavailable, empty, mismatched and oversized playlists", async () => {
  for (const [raw, error] of [
    [rawPage([video()], { playlist_count: 2 }), /incomplete/],
    [rawPage([video(), null]), /unavailable/],
    [rawPage([video(), { ...video(), title: "[Private video]" }]), /unavailable/],
    [rawPage([]), /empty/],
    [rawPage([video()], { webpage_url: `${playlist}X` }), /different playlist/],
    [rawPage([video()], { playlist_count: 501 }), /500/],
    [
      rawPage(
        Array.from({ length: 501 }, () => video()),
        { playlist_count: null },
      ),
      /500/,
    ],
  ] as const)
    await assert.rejects(createYouTubePlaylistLoader(runner(raw))(playlist), error);
  const full = await createYouTubePlaylistLoader(
    runner(rawPage(Array.from({ length: 500 }, () => video()))),
  )(playlist);
  assert.equal(full.items.length, 500);
  assert.equal(full.items.at(-1)?.collection?.index, 499);
  assert.equal(
    (
      await createYouTubePlaylistLoader(
        runner(rawPage([video(), video()], { playlist_count: null })),
      )(playlist)
    ).items.length,
    2,
  );
});

for (const mode of ["append", "play"] as const) {
  test(`whole-playlist ${mode} retains manual precedence without repeating queued occurrences`, async () => {
    const page = await createYouTubePlaylistLoader(
      runner(rawPage([video(), video("bcdefghijkl"), video(), video("cdefghijklm")])),
    )(playlist);
    const entries = page.items.map((item, index): QueueEntry => ({
      id: `entry-${index}`,
      title: item.title,
      source: `web:${item.url}`,
      ...providerMetadata(item, true),
    }));
    const store = openStore(":memory:");
    const resolve = createContinuationResolver(async () => page);
    let resolutions = 0;
    const session = createSession(
      { ...store, ...store.playback("playlist") },
      () => {},
      () => {},
      {
        resolveSource: (entry) => ({ source: entry.source.slice(4) }),
        resolveContinuation: async (entry, signal) => {
          resolutions++;
          return resolve(entry, signal);
        },
      },
    );
    const played: string[] = [];
    const record = () =>
      played.push(
        session.state.queue.find((entry) => entry.id === session.state.currentEntryId)!.source,
      );
    const next = () => {
      session.command({ type: "next", playbackId: session.state.player.playbackId! });
    };
    try {
      const added = session.loadQueue(entries, mode === "play" ? "play" : "append");
      if (mode !== "play") session.command({ type: "play", entryId: added[0]!.id });
      record();
      await flush();
      const manual = {
        id: "manual",
        title: "Manual choice",
        source: `web:${video("defghijklmn").url}`,
      };
      session.command({ type: "enqueue", entry: manual, placement: "next" });
      next();
      record();
      next();
      record();
      next();
      record();
      assert.deepEqual(
        session.state.autoplay?.upcoming.map((entry) => entry.source),
        [entries[3]!.source],
      );
      next();
      record();
      assert.deepEqual(session.state.autoplay?.upcoming, []);
      const count = session.state.queue.length;
      session.observe({
        ...session.state.player,
        status: "playing",
        position: 1,
        duration: 100,
        seekable: true,
      });
      session.observe({
        ...session.state.player,
        status: "ended",
        position: 100,
        duration: 100,
        seekable: true,
      });
      assert.equal(session.state.queue.length, count);
      assert.equal(session.state.player.status, "ended");
      assert.deepEqual(played, [
        entries[0]!.source,
        manual.source,
        ...entries.slice(1).map((entry) => entry.source),
      ]);
      assert.equal(resolutions, mode === "play" ? 0 : 1);
    } finally {
      session.close();
      store.close();
    }
  });
}

test("the last advertised page preserves every occurrence through route parsing, Save and Queue/Play commands", async () => {
  const run = async (args: string[]) => {
    const offset = Number(args[args.indexOf("--playlist-items") + 1]!.split(":")[0]) - 1;
    return JSON.stringify(
      rawPage(
        Array.from({ length: 25 }, (_, index) => video(String(offset + index).padStart(11, "a"))),
        { playlist_count: 2425 },
      ),
    );
  };
  const providers = catalog(createYouTubeBrowser(run));
  const later = forLater(providers);
  try {
    const browse = createYouTubeBrowser(run);
    assert.equal((await browse({ url: playlist, cursor: "2376" })).nextCursor, "2400");
    const response = await providers.handle(
      get(`/api/providers/youtube/items?${new URLSearchParams({ url: playlist, cursor: "2400" })}`),
    );
    assert.equal(response.status, 200);
    const page: ProviderPage = await response.json();
    assert.equal(page.items.length, 24);
    assert.equal(page.nextCursor, undefined);
    assert.deepEqual(
      page.items.map((item) => item.collection?.index),
      Array.from({ length: 24 }, (_, index) => 2400 + index),
    );
    for (const item of page.items) {
      const context = item.collection!;
      const route = readCollectionSearch(
        JSON.parse(JSON.stringify({ provider: "youtube", url: item.url, context })),
      );
      assert.deepEqual(route.context, context);
      assert.equal(providerCollectionCursor("youtube", context), "2400");
      const saved = await later.handle(
        post("/api/for-later", {
          reference: {
            kind: "web",
            url: item.url,
            title: item.title,
            collection: { url: playlist, index: context.index },
          },
        }),
      );
      assert.equal(saved.status, 201, `Save occurrence ${context.index}`);
      assert.deepEqual((await saved.json()).item.collection, context);
    }
    assert.equal((await (await later.handle(get("/api/for-later"))).json()).items.length, 24);
    for (const cursor of ["2401", "2424", "-24", "24.5"])
      await assert.rejects(browse({ url: playlist, cursor }), /Invalid YouTube page/);
    for (const index of [-1, 0, 2399, 2400, 2401, 2423, 2424, 1.5]) {
      const context = { title: "Fixture playlist", url: playlist, index };
      const valid = Number.isInteger(index) && index >= 0 && index <= 2423;
      assert.equal(
        readCollectionSearch({ provider: "youtube", url: video().url, context }).context?.index,
        valid ? index : undefined,
      );
      const command = () =>
        parseCommand(
          JSON.stringify({
            type: "command",
            requestId: "boundary",
            action: {
              type: "enqueueProvider",
              provider: "youtube",
              shape: "atom",
              url: video().url,
              collection: context,
            },
          }),
        );
      if (valid) assert.doesNotThrow(command);
      else assert.throws(command, /Invalid command/);
      const saved = await later.handle(
        post("/api/for-later", {
          reference: { kind: "web", url: video().url, title: "Boundary", collection: context },
        }),
      );
      assert.equal(saved.status < 400, valid, `Save guard occurrence ${index}`);
    }
  } finally {
    later.close();
    providers.close();
  }
});
