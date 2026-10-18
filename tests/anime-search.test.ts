import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { providerBrowseQuery, providerPageQuery } from "../src/client/api/providers";

const credentials = { origin: "http://couch.local", token: "test" };
const request = spyOn(globalThis, "fetch");
afterEach(() => request.mockReset());
afterAll(() => request.mockRestore());

for (const provider of ["animesaturn", "animeunity"] as const) {
  test(`${provider} short searches finish empty without sending the rejected request`, async () => {
    request.mockResolvedValue(Response.json({ error: "Search with 2 to 200 characters." }, { status: 400 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    try {
      const browse = providerBrowseQuery(credentials, provider, { query: "a" });
      const page = providerPageQuery(credentials, provider, { query: "a" });
      expect((await client.fetchInfiniteQuery(browse)).pages).toEqual([{ items: [] }]);
      expect(await client.fetchQuery(page)).toEqual({ items: [] });
      for (const queryKey of [browse.queryKey, page.queryKey]) {
        expect(client.getQueryState(queryKey)).toMatchObject({ status: "success", fetchStatus: "idle", error: null });
      }
      expect(request).not.toHaveBeenCalled();
    } finally { client.clear(); }
  });

  test(`${provider} still reads two-character searches, its catalogue and pasted links`, async () => {
    request.mockImplementation(async () => Response.json({ items: [] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    try {
      for (const target of [{ query: "ab" }, { query: "" }, { query: "a", url: provider === "animesaturn" ? "https://animesaturn.ro/anime/example/" : "https://www.animeunity.so/anime/12-example" }]) {
        await client.fetchQuery(providerPageQuery(credentials, provider, target));
      }
      expect(request).toHaveBeenCalledTimes(3);
    } finally { client.clear(); }
  });
}

test("one-character searches keep providers that support them", async () => {
  request.mockResolvedValue(Response.json({ items: [] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    await client.fetchInfiniteQuery(providerBrowseQuery(credentials, "youtube", { query: "a" }));
    expect(request).toHaveBeenCalledTimes(1);
  } finally { client.clear(); }
});
