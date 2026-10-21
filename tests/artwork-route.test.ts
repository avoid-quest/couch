import { expect, test } from "bun:test";
import { artworkResponse, artworkSizeLimit } from "../src/server/artwork";

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
