import { afterEach, expect, spyOn, test } from "bun:test";
import { iptvRequest } from "../src/client/api/iptv";

const credentials = { origin: "http://couch.local", token: "test-token" };
afterEach(() => { timeout.mockRestore(); fetchSpy.mockRestore(); });
let timeout: ReturnType<typeof spyOn<typeof AbortSignal, "timeout">>;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

test("client deadline gets source-specific safe copy", async () => {
  timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => { throw new DOMException("https://private.example/?token=PRIVATE", "TimeoutError"); }) as typeof fetch);
  await expect(iptvRequest(credentials, "sources/one/refresh", { method: "POST" })).rejects.toThrow("Live TV took too long to respond. Try refreshing the source again.");
});
