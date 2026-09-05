import { expect, setSystemTime, test, afterEach } from "bun:test";
import { browseRaiPlay } from "./raiplay";

const origin = "https://www.raiplay.it";
const episode = {
  name: "Report - Puntata del 31/05/2026", path_id: "/video/2026/05/Report-7a9ae770-92fa-4ce2-bdb6-7d9ac4fb761f.json",
  images: { landscape: "/dl/img/report.jpg" }, duration: "02:48:23", subtitle: "St 2025/26 - Report",
  video_url: "https://mediapolisvod.rai.it/relinker/relinkerServlet.htm?secret=never-returned", login_required: true,
};
const program = { name: "Report", path_id: "/programmi/report.json", images: { landscape: "/dl/img/report.jpg" } };
const setPath = "/programmi/report/ContentSet-13a2c347-f83c-4de5-8e8c-e5519b5217d7.json";
const live = { channel: "Rai News 24", weblink: "//www.raiplay.it/dirette/rainews24", stillFrame: "https://www.rai.it/dl/img/live.jpg", video: { contentUrl: "https://mediapolis.rai.it/private" } };

function fixture(respond: (url: URL, init: RequestInit) => unknown | Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: init || {} });
    const result = respond(url, init || {});
    return result instanceof Response ? result : Response.json(result);
  }) as typeof fetch;
  return { calls, browse: (requestOptions = {}, signal?: AbortSignal) => browseRaiPlay(requestOptions, signal, request) };
}

afterEach(() => setSystemTime());

test("home collections open live TV and public catalog groups", async () => {
  const api = fixture(url => url.hostname === "www.rai.it" ? { name: "Dirette", dirette: [live] } : {
    title: "RaiPlay", contents: [{ id: "PublishingBlock-1234-abcd", name: "Programmi", type: "RaiPlay Slider Block", contents: [program] }],
  });
  const home = await api.browse();
  expect(home.items.map(item => item.kind)).toEqual(["collection", "collection", "collection"]);
  const channels = await api.browse({ url: home.items[0]!.url });
  expect(channels.items[0]).toMatchObject({ kind: "media", live: true, title: "Rai News 24", url: `${origin}/dirette/rainews24` });
  const programs = await api.browse({ url: home.items[2]!.url });
  expect(programs.items[0]).toMatchObject({ kind: "collection", title: "Report", url: `${origin}/programmi/report` });
  expect(api.calls.every(call => call.init.redirect === "error" && call.init.credentials === "omit")).toBeTrue();
  expect(JSON.stringify(channels)).not.toContain("mediapolis");
});

test("programs expose sets and episodes as canonical page URLs with bounded pagination", async () => {
  const api = fixture(url => url.pathname === "/programmi/report.json" ? {
    name: "Report", program_info: { ...program, weblink: "/programmi/report" }, first_item_path: episode.path_id,
    blocks: [{ name: "Puntate", sets: [{ name: "Stagione 2025-2026", path_id: setPath }] }],
  } : { name: "Stagione 2025-2026", items: Array.from({ length: 30 }, (_, index) => ({ ...episode, path_id: `/video/2026/05/Report-${index}.json` })) });
  const sets = await api.browse({ url: `${origin}/programmi/report` });
  expect(sets.items[0]!.kind).toBe("media");
  expect(sets.items[1]).toMatchObject({ kind: "collection", title: "Puntate - Stagione 2025-2026", url: origin + setPath });
  const first = await api.browse({ url: sets.items[1]!.url });
  const last = await api.browse({ url: sets.items[1]!.url, cursor: first.nextCursor });
  expect(first.items).toHaveLength(24);
  expect(last.items).toHaveLength(6);
  expect(last.nextCursor).toBeUndefined();
  expect(first.items[0]).toMatchObject({ kind: "media", duration: 10103, thumbnail: `${origin}/dl/img/report.jpg`, url: `${origin}/video/2026/05/Report-0.html` });
  expect(new Set([...first.items, ...last.items].map(item => item.id)).size).toBe(30);
  expect(JSON.stringify(first)).not.toContain("secret");
});

test("anonymous web search returns programs and videos and advances both result offsets", async () => {
  const api = fixture((_url, init) => {
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({ templateIn: "6470a982e4e0301afe1f81f1", templateOut: "6516ac5d40da6c377b151642", params: { param: "Report Rai", size: 12, additionalSize: 12, onlyVideoQuery: false, onlyProgramsQuery: false } });
    const from = payload.params.from;
    return { agg: { titoli: { totale: 1, cards: from ? [] : [{ titolo: "Report", url: "/programmi/report" }] }, video: {
      totale: 13, cards: Array.from({ length: from ? 1 : 12 }, (_, index) => ({ titolo: `Episode ${from + index}`, url: `/video/2026/05/Report-${from + index}.html`, durata: "00:25:00", immagine: "/dl/img/report.jpg", programma: "Report" })),
    } } };
  });
  const first = await api.browse({ query: "  Report  Rai  " });
  const next = await api.browse({ query: "Report Rai", cursor: first.nextCursor });
  expect(first.items).toHaveLength(13);
  expect(first.items[0]!.kind).toBe("collection");
  expect(first.items[1]).toMatchObject({ kind: "media", duration: 1500, subtitle: "Report" });
  expect(first.nextCursor).toBe("12");
  expect(next.items).toHaveLength(1);
  expect(next.nextCursor).toBeUndefined();
  expect(api.calls[0]!.url.pathname).toBe("/atomatic/raiplay-search-service/api/v1/msearch");
  expect(api.calls[0]!.init.method).toBe("POST");
});

test("genre pages browse the current A-Z dictionary schema", async () => {
  const api = fixture(() => ({ name: "Programmi - Tutti", contents: { R: [program], A: [{ ...program, name: "Agorà", path_id: "/programmi/agora.json" }] } }));
  const result = await api.browse({ url: `${origin}/genere/Programmi---Tutti-20269973-8d0d-4cc4-9f82-66bd9fa2b03a.html` });
  expect(result.items.map(item => item.title)).toEqual(["Agorà", "Report"]);
});

test("replay uses Italian dates, channel schedules and only available video pages", async () => {
  setSystemTime(new Date("2026-09-04T23:30:00Z"));
  const api = fixture(url => url.hostname === "www.rai.it" ? { dirette: [live] } : {
    "Rai News 24": [{ palinsesto: [{ programmi: [{}, { name: "Unavailable", hasVideo: false }, {
      name: "RASSEGNA STAMPA", hasVideo: true, timePublished: "07:03", duration: "00:25:00",
      pathID: "/video/2026/09/RASSEGNA-STAMPA-e440a51a-b290-4de7-9208-f75b46a312d7.html?json",
    }] }] }],
  });
  const dates = await api.browse({ url: `${origin}/guidatv` });
  expect(dates.items).toHaveLength(7);
  expect(dates.items[0]!.title).toBe("05/09/2026");
  const channels = await api.browse({ url: dates.items[0]!.url });
  const replay = await api.browse({ url: channels.items[0]!.url });
  expect(replay.items).toHaveLength(1);
  expect(replay.items[0]).toMatchObject({ kind: "media", title: "RASSEGNA STAMPA", duration: 1500, subtitle: "07:03" });
  expect(replay.items[0]!.url).not.toContain("?");
  expect(api.calls[1]!.url.pathname).toBe("/palinsesto/app/old/RaiNews24/05-09-2026.json");
});

test("rejects external URLs, credentials, invalid selectors and invalid pagination before fetching", async () => {
  const api = fixture(() => { throw new Error("Must not fetch"); });
  for (const url of ["http://127.0.0.1/", "https://www.raiplay.it.evil.test/programmi/report", "https://user:pass@www.raiplay.it/programmi/report", "https://www.raiplay.it:8000/programmi/report", `${origin}/programmi/report?token=secret`, `${origin}/assets/private.json`, `${origin}/#block=../../etc/passwd`, `${origin}/guidatv#date=1900-01-01`]) {
    await expect(api.browse({ url })).rejects.toMatchObject({ status: 400 });
  }
  for (const cursor of ["-1", "1.5", "Infinity", "10000", "http://localhost"]) await expect(api.browse({ cursor })).rejects.toMatchObject({ status: 400 });
  await expect(api.browse({ query: "x" })).rejects.toMatchObject({ status: 400 });
  expect(api.calls).toHaveLength(0);
});

test("drops unsafe provider links and thumbnail hosts while keeping valid episodes", async () => {
  const api = fixture(() => ({ name: "Episodes", items: [episode, { ...episode, path_id: "http://localhost/private" }, { ...episode, path_id: "/video/2026/05/Other.json", images: { landscape: "https://evil.test/track" } }, episode] }));
  const result = await api.browse({ url: origin + setPath });
  expect(result.items).toHaveLength(2);
  expect(result.items[1]!.thumbnail).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("mediapolis");
});

test("long media and collection titles fit the queue and favorites contract", async () => {
  const title = "A".repeat(250);
  const api = fixture(() => ({ title: "RaiPlay", contents: [{ id: "PublishingBlock-1234-abcd", name: title, contents: [{ ...episode, name: title }, { ...program, name: title }] }] }));
  const home = await api.browse();
  const group = home.items[2]!;
  expect(group.title).toBe(title.slice(0, 200));
  const items = (await api.browse({ url: group.url })).items;
  expect(items.map(item => item.kind)).toEqual(["media", "collection"]);
  expect(items.map(item => item.title)).toEqual([title.slice(0, 200), title.slice(0, 200)]);
});

test("reports upstream schema failures and cancels oversized response bodies", async () => {
  await expect(fixture(() => ({ unexpected: [] })).browse()).rejects.toMatchObject({ status: 502 });
  await expect(fixture(() => ({ agg: {} })).browse({ query: "Report" })).rejects.toMatchObject({ status: 502 });
  let cancelled = false;
  const api = fixture(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Length": String(4 * 1024 * 1024 + 1) } }));
  await expect(api.browse()).rejects.toThrow("too much data");
  expect(cancelled).toBeTrue();
});

test("cancellation propagates through a stalled catalog response", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const api = fixture(() => new Response(new ReadableStream({ start() { queueMicrotask(() => controller.abort()); }, cancel() { cancelled = true; } })));
  await expect(api.browse({}, controller.signal)).rejects.toThrow();
  expect(cancelled).toBeTrue();
  await expect(api.browse({}, controller.signal)).rejects.toThrow();
  expect(api.calls).toHaveLength(1);
});

test.skipIf(!process.env.RAIPLAY_LIVE_TEST)("public RaiPlay catalog, search, episode selection and replay", async () => {
  const home = await browseRaiPlay({});
  const livePage = await browseRaiPlay({ url: home.items[0]!.url });
  expect(livePage.items.some(item => item.url === `${origin}/dirette/rainews24` && item.live)).toBeTrue();
  const found = await browseRaiPlay({ query: "Report" });
  const report = found.items.find(item => item.url === `${origin}/programmi/report`);
  expect(report).toBeDefined();
  const programPage = await browseRaiPlay({ url: report!.url });
  const episodes = await browseRaiPlay({ url: programPage.items.find(item => item.kind === "collection")!.url });
  expect(episodes.items.some(item => item.kind === "media" && item.url.startsWith(`${origin}/video/`))).toBeTrue();
  const dates = await browseRaiPlay({ url: `${origin}/guidatv` });
  const replay = await browseRaiPlay({ url: `${dates.items[0]!.url}&channel=RaiNews24` });
  expect(replay.items.every(item => item.kind === "media")).toBeTrue();
}, 60_000);
