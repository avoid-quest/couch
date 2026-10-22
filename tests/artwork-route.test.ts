import { expect, test } from "bun:test";
import { artworkResponse, artworkSizeLimit, createArtworkCache } from "../src/server/artwork";

const ask = (url: string, init?: RequestInit) => new Request(`http://couch.test/api/artwork?${new URLSearchParams({ url })}`, init);
const paired = () => {};
const picture = (type: string, body: BodyInit = new Uint8Array([1, 2, 3])) => (async () => new Response(body, { headers: { "content-type": type } })) as unknown as typeof fetch;

test("returns a public picture's bytes from Core's origin, marked so nothing in it runs", async () => {
  const response = await artworkResponse(ask("https://img.example/cover.jpg"), paired, picture("image/jpeg"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
});

test("asks only for pairs, web addresses and raster pictures within the limit", async () => {
  expect((await artworkResponse(ask("https://img.example/a.jpg"), () => { throw new Error("Pair this device first."); }, picture("image/jpeg"))).status).toBe(401);
  for (const address of ["file:///etc/passwd", "https://user:secret@img.example/a.jpg", "not an address"]) expect((await artworkResponse(ask(address), paired, picture("image/jpeg"))).status).toBe(400);
  expect((await artworkResponse(ask("https://img.example/logo.svg"), paired, picture("image/svg+xml"))).status).toBe(502);
  expect((await artworkResponse(ask("https://img.example/page"), paired, picture("text/html"))).status).toBe(502);
  expect((await artworkResponse(ask("https://img.example/huge.png"), paired, picture("image/png", new Uint8Array(artworkSizeLimit + 1)))).status).toBe(502);
  expect((await artworkResponse(ask("https://img.example/a.jpg", { method: "POST" }), paired, picture("image/jpeg"))).status).toBe(405);
});

test("a host that fails gives no picture rather than an error page", async () => {
  const failing = (async () => { throw new TypeError("connect ECONNREFUSED"); }) as unknown as typeof fetch;
  expect((await artworkResponse(ask("https://img.example/a.jpg"), paired, failing)).status).toBe(502);
});

test("a picture read before comes from Core's memory, not its host, and still only for pairs", async () => {
  const cache = createArtworkCache();
  let fetches = 0;
  const counted = (async () => { fetches++; return new Response(new Uint8Array([4, 5, 6]), { headers: { "content-type": "image/png" } }); }) as unknown as typeof fetch;
  for (let read = 0; read < 3; read++) {
    const response = await artworkResponse(ask("https://img.example/kept.png"), paired, counted, cache);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 5, 6]);
  }
  expect(fetches).toBe(1);
  expect((await artworkResponse(ask("https://img.example/kept.png"), () => { throw new Error("Pair this device first."); }, counted, cache)).status).toBe(401);
  // What isn't a picture is never kept: the next read asks the host again.
  await artworkResponse(ask("https://img.example/page"), paired, picture("text/html"), cache);
  expect((await artworkResponse(ask("https://img.example/page"), paired, picture("image/jpeg"), cache)).status).toBe(200);
});

test("the cache keeps the newest pictures within its byte budget", () => {
  const cache = createArtworkCache(400);
  cache.set("a", "image/png", new Uint8Array(100));
  cache.set("b", "image/png", new Uint8Array(100));
  cache.set("c", "image/png", new Uint8Array(100));
  cache.get("a");
  cache.set("d", "image/png", new Uint8Array(100));
  cache.set("e", "image/png", new Uint8Array(100));
  expect(cache.size).toBe(400);
  expect(cache.get("b")).toBeUndefined();
  for (const key of ["a", "c", "d", "e"]) expect(cache.get(key)).toBeDefined();
  // A picture over a quarter of the budget is never kept.
  cache.set("big", "image/png", new Uint8Array(101));
  expect(cache.get("big")).toBeUndefined();
});
