import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { createSubtitles, sourceSubtitle, subtitleSizeLimit } from "../src/server/subtitles";

const upstream = "https://subtitles.example/captions.srt";
const address = () => new URL(sourceSubtitle(upstream), "http://couch.local");
const subtitles = createSubtitles(() => undefined, () => {});
const request = spyOn(globalThis, "fetch");
afterEach(() => request.mockReset());
afterAll(() => request.mockRestore());
const cue = "1\n00:00:00,000 --> 00:00:01,000\nCiao\n";

test("source subtitles convert SRT and reject a changed signed URL before fetching", async () => {
  request.mockResolvedValue(new Response(cue));
  const response = await subtitles.serve(address());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(`WEBVTT\n\n${cue.replaceAll(",", ".")}`);
  const changed = address();
  changed.searchParams.set("url", "https://other.example/captions.srt");
  expect((await subtitles.serve(changed)).status).toBe(404);
  expect(request).toHaveBeenCalledTimes(1);
});

test("source subtitles stop a chunked download at the byte limit before decoding", async () => {
  let canceled = false;
  const chunk = new TextEncoder().encode("é".repeat(subtitleSizeLimit / 4));
  let pulls = 0;
  request.mockResolvedValue(new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(chunk); },
    cancel() { canceled = true; },
  })));
  expect((await subtitles.serve(address())).status).toBe(502);
  expect(canceled).toBe(true);
  expect(pulls).toBeLessThanOrEqual(4);
});

test("oversized Content-Length and failed upstream responses cancel their bodies", async () => {
  for (const init of [{ headers: { "Content-Length": String(subtitleSizeLimit + 1) } }, { status: 404 }]) {
    let canceled = false;
    request.mockResolvedValue(new Response(new ReadableStream({ cancel() { canceled = true; } }), init));
    expect((await subtitles.serve(address())).status).toBe(502);
    expect(canceled).toBe(true);
  }
});
