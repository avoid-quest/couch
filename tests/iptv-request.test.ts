import { afterEach, expect, spyOn, test } from "bun:test";
import { iptvRequest } from "../src/client/api/iptv";
import { apiFetch } from "../src/client/api/client";

const credentials = { origin: "http://couch.local", token: "test-token" };
afterEach(() => { timeout.mockRestore(); fetchSpy.mockRestore(); });
let timeout: ReturnType<typeof spyOn<typeof AbortSignal, "timeout">>;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
function transport(run: typeof fetch) {
  timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(run);
}

test("Live TV allows Core's 20-second budget plus margin; other callers keep 15 seconds", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  transport((async (url, init) => { requests.push({ url: String(url), init }); return Response.json({ ok: true }); }) as typeof fetch);
  await iptvRequest(credentials, "sources/one/refresh", { method: "POST" });
  expect(timeout).toHaveBeenNthCalledWith(1, 25_000);
  expect(requests[0]?.url).toBe("http://couch.local/api/iptv/sources/one/refresh");
  expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBe("Bearer test-token");
  await apiFetch(credentials, "/api/health");
  expect(timeout).toHaveBeenNthCalledWith(2, 15_000);
});

test("Core's safe source failure survives, and retry makes another request", async () => {
  let attempts = 0;
  transport((async () => ++attempts === 1
    ? Response.json({ error: "Couldn't read the source. Saved channels and guide data were kept." }, { status: 502 })
    : Response.json({ source: { channelCount: 30 } })) as typeof fetch);
  await expect(iptvRequest(credentials, "sources/one/refresh", { method: "POST" })).rejects.toThrow("Saved channels and guide data were kept.");
  expect((await iptvRequest(credentials, "sources/one/refresh", { method: "POST" })).status).toBe(200);
  expect(attempts).toBe(2);
});

test("client deadline gets source-specific safe copy", async () => {
  transport((async () => { throw new DOMException("https://private.example/?token=PRIVATE", "TimeoutError"); }) as typeof fetch);
  await expect(iptvRequest(credentials, "sources/one/refresh", { method: "POST" })).rejects.toThrow("Live TV took too long to respond. Try refreshing the source again.");
});

test("caller cancellation reaches fetch and stays a cancellation", async () => {
  let observed: AbortSignal | null | undefined;
  transport((async (_url, init) => {
    observed = init?.signal;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  }) as typeof fetch);
  const controller = new AbortController();
  const pending = iptvRequest(credentials, "sources/one/refresh", { method: "POST", signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(observed?.aborted).toBe(true);
});
