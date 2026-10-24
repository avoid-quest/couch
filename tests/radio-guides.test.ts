import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseGuideChannels, parseGuidePrograms, xmltvTime } from "../src/server/iptv-feeds";
import { readRadioSource } from "../src/server/radio-playlists";
import { createRadioGuides } from "../src/server/radio-guides";
import { radioLabels, radioNow, radioNext, radioHost, radioShowLabels, radioMatches, type RadioGuide, type RadioProgrammeDetails } from "../src/shared/radio";

const playlist = readFileSync(new URL("./fixtures/radio/community.m3u", import.meta.url), "utf8");
const xml = readFileSync(new URL("./fixtures/radio/community.xml", import.meta.url), "utf8");
const start = Date.parse("2026-10-24T23:30:00Z"), end = start + 3_600_000;
const now = start + 900_000;
const live: RadioProgrammeDetails = { stationId: "main", provider: "radio.avoid.quest", title: "Night Shift", sampledAt: now - 1000, expiresAt: end + 900_000,
  genre: "Jazz", artist: "Alex", album: "Night series", artworkUrl: "https://example.com/live.jpg", description: "Live description", programmeUrl: "https://example.com/show", bitrate: 192 };
const guide: RadioGuide = { programmes: [{ id: "one", title: "Night Shift", start, end, categories: ["Experimental"], description: "Guide description" }, { id: "two", title: "After Hours", start: end + 3_600_000, end: end + 7_200_000 }], live };

test("generic radio M3U discovers a relative guide, keeps exact IDs and does not execute directives", async () => {
  const source = await readRadioSource("https://community.example/list.m3u", "source", async () => new Response(playlist), new AbortController().signal);
  expect(source.discoveredGuideUrl).toBe("https://community.example/guide.xml");
  expect(source.stations).toHaveLength(3);
  const other = await readRadioSource("https://community.example/list.m3u", "other", async () => new Response(playlist), new AbortController().signal);
  expect(other.stations[0]!.id).not.toBe(source.stations[0]!.id);
  const untrusted = await readRadioSource("https://community.example/list.m3u", "source", async () => new Response(playlist.replace('guide.xml', 'http://127.0.0.1/private')), new AbortController().signal);
  expect(untrusted.discoveredGuideUrl).toBeNull();
  await expect(readRadioSource("https://community.example/list.m3u", "source", async () => new Response(playlist.replace('radio="true"', 'http-user-agent="custom"')), new AbortController().signal)).rejects.toThrow("custom HTTP headers");
});

test("shared XMLTV retains categories and optional safe artwork, permits partial radio coverage, and keeps TV strict", () => {
  const channels = [{ id: "main", tvgId: "community.main" }, { id: "missing", tvgId: "community.unscheduled" }];
  const rows = parseGuidePrograms(xml, channels, { partial: true, base: "https://community.example/guide.xml" });
  expect(rows[0]).toMatchObject({ channelId: "main", start, end, categories: ["Jazz", "Experimental"], artworkUrl: "https://community.example/art/night.jpg" });
  expect(rows[1]!.artworkUrl).toBeUndefined();
  expect(rows[1]!.start).toBe(end + 3_600_000); // repeated local 02:30, on the other side of DST
  expect(parseGuidePrograms(xml, [{ id: "wrong", tvgId: "Community.main" }], { partial: true })).toEqual([]);
  expect(() => parseGuidePrograms(xml, channels)).toThrow("match");
  expect(() => parseGuideChannels(playlist, "source", "https://example.com/list")).toThrow("television");
  expect(parseGuidePrograms('<tv><channel id="one"/></tv>', [{ id: "one", tvgId: "one" }])).toEqual([]);
  expect(() => parseGuidePrograms('<!DOCTYPE tv [<!ENTITY x "bad">]><tv/>', [])).toThrow("DTD");
  expect(xmltvTime("20261025013000")).toBe(Date.parse("2026-10-25T01:30:00Z"));
});

test("schedule precedence, enrichment matching, freshness, gaps and next entries share one rule", () => {
  const current = radioNow(guide, "station", now)!;
  expect(current).toMatchObject({ title: "Night Shift", description: "Guide description", artworkUrl: live.artworkUrl, artist: "Alex", expiresAt: end, start, end });
  expect(radioShowLabels(current)).toEqual(["Experimental", "Jazz"]);
  expect(radioHost(current)).toBe("Alex");
  // A show named after its host says the host once, in its title.
  expect(radioHost({ ...current, title: "DJ Alé", artist: "dj ale" })).toBeUndefined();
  expect(radioNow({ ...guide, programmes: [{ ...guide.programmes[0]!, artworkUrl: "https://example.com/scheduled.jpg" }] }, "station", now)?.artworkUrl).toBe("https://example.com/scheduled.jpg");
  expect(radioNow({ ...guide, live: { ...live, sampledAt: start - 1 } }, "station", now)?.artworkUrl).toBeUndefined();
  expect(radioNow({ ...guide, live: { ...live, expiresAt: now } }, "station", now)?.artworkUrl).toBeUndefined();
  expect(radioNow(guide, "station", end)).toBeNull();
  expect(radioNext(guide, end)?.title).toBe("After Hours");
  const next = radioNow(guide, "station", end + 3_600_000)!;
  expect(next.title).toBe("After Hours");
  expect(next.artworkUrl).toBeUndefined();
  expect(next.genre).toBeUndefined();
  expect(radioNow({ programmes: [], live }, "station", now)).toEqual(live);
  expect(radioNow(undefined, "station", now)).toBeNull();
  const overlap = { ...guide, programmes: [...guide.programmes, { id: "overlap", title: "New overlapping slot", start: now + 1000, end }] };
  expect(radioNow(overlap, "station", now)?.expiresAt).toBe(now + 1000);
  expect(radioNow(overlap, "station", now + 1000)?.title).toBe("New overlapping slot");
  expect(radioLabels([" Jazz ", "jazz", "Deep   House", "Deep House", "R&B", "R / B"])).toEqual(["Jazz", "Deep House", "R&B", "R / B"]);
  expect(radioMatches({ name: "Station", groupTitle: "Network", tags: ["Talk"] } as never, "Alex", current)).toBe(true);
});

test("a broad schedule slot does not replace a fresh live show's title and artwork", () => {
  const slot = { id: "rotation", title: "Rotation", start, end, artworkUrl: "https://example.com/slot.jpg", description: "Schedule slot", categories: ["Talk"] };
  const rotation: RadioGuide = { programmes: [slot, guide.programmes[1]!], live };
  const current = radioNow(rotation, "station", now)!;
  expect(current.title).toBe(live.title);
  expect(current.artworkUrl).toBe(live.artworkUrl);
  expect(current.artist).toBe(live.artist);
  expect(current.start).toBeUndefined();
  expect(current.end).toBeUndefined();
  expect(current.description).toBe(live.description);
  expect(current.programmeUrl).toBe(live.programmeUrl);
  expect(current.expiresAt).toBe(end);
  expect(radioShowLabels(current)).toEqual(["Jazz"]);
  const sparse = radioNow({ ...rotation, live: { ...live, description: undefined, artworkUrl: undefined } }, "station", now)!;
  expect(sparse.description).toBeUndefined();
  expect(sparse.artworkUrl).toBeUndefined();
  expect(sparse.categories).toBeUndefined();
  // Expiry restores the guide; a live observation never crosses a known broadcast boundary or gap.
  expect(radioNow({ ...rotation, live: { ...live, expiresAt: now } }, "station", now)).toMatchObject(slot);
  expect(radioNow({ ...rotation, live: { ...live, sampledAt: start - 1 } }, "station", now)).toMatchObject(slot);
  expect(radioNow(rotation, "station", end)).toBeNull();
  expect(radioNow(rotation, "station", end + 3_600_000)).toMatchObject({ title: "After Hours" });
  expect(radioNow(rotation, "station", end + 3_600_000)?.artworkUrl).toBeUndefined();
  expect(radioNext(rotation, now)).toEqual(guide.programmes[1]!);
});

test("guide reads share cache and retry-after, restrict redirects, and explicitly allow another origin", async () => {
  let calls = 0, clock = now, mode = "limited";
  const hub = createRadioGuides({ now: () => clock, signal: new AbortController().signal, fetch: async () => {
    calls++;
    if (mode === "limited") return new Response(null, { status: 429, headers: { "Retry-After": "300" } });
    if (mode === "redirect") return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    return new Response(xml);
  } });
  const source = { id: "source", url: "https://community.example/list", discoveredGuideUrl: "https://community.example/guide.xml" } as never;
  const stations = [{ id: "station", tvgId: "community.main" }] as never;
  await Promise.all([hub.get(source, stations), hub.get(source, stations)]);
  expect(calls).toBe(1);
  clock += 60_000;
  await hub.get(source, stations); expect(calls).toBe(1);
  clock += 240_000; mode = "redirect";
  await hub.get(source, stations); expect(calls).toBe(2);
  mode = "ok";
  const explicit = await hub.get({ ...source as object, guideUrl: "https://another.example/guide.xml" } as never, stations);
  expect(explicit.programmes.get("station")).toHaveLength(2);
  await hub.get({ ...source as object, guideUrl: "https://another.example/guide.xml" } as never, stations);
  expect(calls).toBe(3);
});

test("JSON enrichment expiry, stream validation and rate limiting remain independent of programme windows", async () => {
  const { createRadioMetadata } = await import("../src/server/radio-metadata");
  let clock = now, calls = 0, mode = "valid";
  const hub = createRadioMetadata({ now: () => clock, fetch: async () => {
    calls++;
    if (mode === "limited") return new Response(null, { status: 429, headers: { "Retry-After": "120" } });
    return Response.json({ ok: true, data: { ...live, streamUrl: "https://audio.example/live", resolvedUrl: "https://never-play.example/", artworkUrl: live.artworkUrl } });
  } });
  const initial = await hub.get("station", "https://audio.example/live");
  expect(initial.programme?.title).toBe("Night Shift");
  expect(initial.programme?.start).toBeUndefined();
  expect(initial.programme?.end).toBeUndefined();
  expect((await hub.get("station", "https://audio.example/other")).programme).toBeNull();
  clock = live.expiresAt;
  expect((await hub.get("station", "https://audio.example/live")).programme).toBeNull();
  mode = "limited"; clock += 60_000;
  const limited = await hub.get("station", "https://audio.example/live");
  const before = calls;
  await hub.get("another-station", "https://audio.example/another");
  expect(calls).toBe(before);
  expect(limited.retryAt).toBe(clock + 120_000);
});
