import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { MetadataView } from "../shared/metadata";
import { createLibrary } from "./library";
import { createMediaFolders } from "./media-folders";
import { parseVideoNfo } from "./video-metadata";
import { createTmdb } from "./tmdb";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const administrator: ControllerIdentity = { authority: "administrator", controller: { id: "admin", name: "Phone", role: "administrator", createdAt: null, lastSeenAt: null }, claimAvailable: false };
const cover = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aJcAAAAASUVORK5CYII=", "base64");
async function fixture(episode = false, numbered = false) {
  const filename = numbered ? "sample.S01E01" : "sample";
  const root = await mkdtemp(join(tmpdir(), "couch-metadata-"));
  cleanup.push(() => rm(root, { force: true, recursive: true }));
  const media = join(root, "media"); await mkdir(media);
  const databasePath = join(root, "library.sqlite");
  const folders = createMediaFolders({ roots: [realpathSync(tmpdir())], mountInfo: async () => null });
  const library = createLibrary({ databasePath, folders, ffprobePath: null });
  cleanup.push(() => library.close());
  const xml = `<${episode ? "episodedetails" : "movie"} custom="keep"><title>Wrong title</title><plot>Original plot</plot><rating name="custom">8.7</rating><!-- keep this --><unknown attr="a&amp;b"><child>one</child><child>two</child></unknown>${episode ? "<season>1</season><episode>7</episode><showtitle>Local show</showtitle>" : ""}</${episode ? "episodedetails" : "movie"}>`;
  await Bun.write(join(media, `${filename}.mkv`), "original media bytes");
  await Bun.write(join(media, `${filename}.nfo`), xml);
  const source = await library.addSource(media); await library.scan(source.id);
  const id = library.search().items[0]!.id;
  const request = (path: string, value?: unknown, identity = () => administrator) => library.metadata.handle(new Request(`http://localhost/api/metadata/${path}`, value === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }), identity);
  const view = async (): Promise<MetadataView> => (await request(`items/${id}`)).json();
  return { root, media, databasePath, folders, library, source, id, request, view, xml, filename };
}

test("manual corrections and artwork survive rescan, offline restart and export/reimport without changing source files", async () => {
  const f = await fixture();
  const before = await f.view();
  const response = await f.request(`items/${f.id}/edit`, { revision: before.revision, changes: { title: "Correct & final", plot: "Manual plot" }, artwork: cover.toString("base64") });
  expect(response.status).toBe(200);
  const edited: MetadataView = await response.json();
  expect(edited.origins.title).toBe("Manual"); expect(edited.origins.year).toBe("Imported/local");
  expect(f.library.search({ query: "Correct" }).items[0]?.id).toBe(f.id);
  await f.library.scan(f.source.id);
  expect((await f.view()).values).toEqual(edited.values);
  expect(await readFile(join(f.media, "sample.nfo"), "utf8")).toBe(f.xml);
  expect(await readFile(join(f.media, "sample.mkv"), "utf8")).toBe("original media bytes");
  const exported = await f.request(`items/${f.id}/export`, { revision: (await f.view()).revision });
  expect(exported.status).toBe(200); expect(exported.headers.get("Content-Disposition")).toContain("attachment;");
  const files = await new Bun.Archive(await exported.arrayBuffer()).files();
  const xml = await files.get("metadata.nfo")!.text();
  expect(xml).toContain('custom="keep"'); expect(xml).toContain('<rating name="custom">8.7</rating>'); expect(xml).toContain('attr="a&amp;b"'); expect(xml).toContain("<!-- keep this -->");
  expect(await files.get("original-0.nfo")!.text()).toBe(f.xml);
  expect(parseVideoNfo(new TextEncoder().encode(xml)).fields.title).toBe("Correct & final");
  const imported = join(f.root, "reimport"); await mkdir(imported);
  await Bun.write(join(imported, "sample.mkv"), "separate fixture");
  await Bun.write(join(imported, "sample.nfo"), xml);
  await Bun.write(join(imported, "sample-poster.png"), files.get("artwork-0.png")!);
  const source = await f.library.addSource(imported); await f.library.scan(source.id);
  expect(f.library.search({ query: "Correct" }).items).toHaveLength(2);
  expect(f.library.search({ query: "Correct" }).items.every(i => i.artworkId === edited.values.artworkId)).toBe(true);
  await rename(f.media, join(f.root, "offline")); await f.library.scan(f.source.id); await f.library.close();
  const reopened = createLibrary({ databasePath: f.databasePath, folders: f.folders, ffprobePath: null }); cleanup.push(() => reopened.close());
  expect(reopened.getItem(f.id)).toMatchObject({ title: "Correct & final", available: false, artworkId: edited.values.artworkId });
});

test("concurrent edits and an aborted SQL write leave title, artwork, search and revision atomic", async () => {
  const f = await fixture();
  const original = await f.view();
  const first = await f.request(`items/${f.id}/edit`, { revision: original.revision, changes: { title: "First wins" } });
  expect(first.status).toBe(200);
  expect((await f.request(`items/${f.id}/edit`, { revision: original.revision, changes: { title: "Stale edit" } })).status).toBe(409);
  const current = await f.view();
  const connection = new Database(f.databasePath);
  connection.run("CREATE TRIGGER reject_metadata BEFORE UPDATE ON library_items BEGIN SELECT RAISE(ABORT, 'fixture disk write failure'); END;");
  const failed = await f.request(`items/${f.id}/edit`, { revision: current.revision, changes: { title: "Partial edit" }, artwork: cover.toString("base64") });
  expect(failed.status).toBe(500); expect(await f.view()).toEqual(current);
  expect(f.library.search({ query: "Partial" }).total).toBe(0); expect(f.library.search({ query: "First" }).total).toBe(1);
  expect(connection.query("SELECT COUNT(*) AS count FROM library_artwork").get()).toEqual({ count: 0 }); connection.close();
});

test("episode order changes sorting and exports the corrected order", async () => {
  const f = await fixture(true);
  const original = await f.view();
  expect((await f.request(`items/${f.id}/edit`, { revision: original.revision, changes: { showTitle: null } })).status).toBe(400);
  expect((await f.request(`items/${f.id}/edit`, { revision: original.revision, changes: { season: 0, episode: 2, title: "Special" } })).status).toBe(200);
  await f.library.scan(f.source.id);
  expect(f.library.getItem(f.id)?.video).toMatchObject({ season: 0, episode: 2 });
  const exportResponse = await f.request(`items/${f.id}/export`, { revision: (await f.view()).revision });
  const files = await new Bun.Archive(await exportResponse.arrayBuffer()).files();
  expect(parseVideoNfo(new Uint8Array(await files.get("metadata.nfo")!.arrayBuffer())).fields).toMatchObject({ season: "0", episode: "2" });
});

test("provider credentials are write-only and guest or revoked callers cannot change metadata", async () => {
  const f = await fixture();
  expect((await f.request("provider", { token: "private-api-token" })).status).toBe(200);
  expect(await (await f.request("provider")).json()).toEqual({ configured: true, provider: "TMDB" });
  const before = await f.view();
  const guest = () => ({ ...administrator, authority: "controller" as const });
  expect((await f.request(`items/${f.id}`, undefined, guest)).status).toBe(403);
  expect((await f.request(`items/${f.id}/edit`, { revision: before.revision, changes: { title: "Attack" } }, guest)).status).toBe(403);
  expect((await f.request(`items/${f.id}/export`, { revision: before.revision }, guest)).status).toBe(403);
  let calls = 0;
  const revoked = () => ++calls === 1 ? administrator : null;
  const request = new Request(`http://localhost/api/metadata/items/${f.id}/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: before.revision, changes: { title: "Revoked" } }) });
  expect((await f.library.metadata.handle(request, revoked)).status).toBe(401);
  expect(await f.view()).toEqual(before);
  expect(JSON.stringify(f.library.search())).not.toContain("private-api-token");
});

test("bad artwork, malformed changes and missing provider access leave corrections unchanged", async () => {
  const f = await fixture(); const before = await f.view();
  for (const changes of [{ season: 4 }, { title: "" }, { premiered: "2026-02-30" }, { unknown: "field" }]) expect((await f.request(`items/${f.id}/edit`, { revision: before.revision, changes })).status).toBe(400);
  expect((await f.request(`items/${f.id}/edit`, { revision: before.revision, changes: { title: "No partial update" }, artwork: "bm90LWFuLWltYWdl" })).status).toBe(400);
  expect((await f.request(`items/${f.id}/search`, { query: "Movie" })).status).toBe(409);
  expect(await f.view()).toEqual(before);
});

test("TMDB contract uses fixed origins, bearer auth, explicit movie/episode details and rejects failed artwork", async () => {
  const seen: Array<{ url: string; auth: string | null; redirect: RequestRedirect | undefined }> = [];
  let failImage = false;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); seen.push({ url, auth: new Headers(init?.headers).get("Authorization"), redirect: init?.redirect });
    if (url.includes("image.tmdb.org")) return new Response(failImage ? "bad image" : cover);
    if (url.endsWith("configuration")) return Response.json({ images: { secure_base_url: "https://image.tmdb.org/t/p/", poster_sizes: ["w500"], still_sizes: ["w300"] } });
    if (url.includes("search/")) return Response.json({ results: [{ id: 12, title: "Search movie", release_date: "2020-01-01" }] });
    if (url.includes("/season/")) return Response.json({ id: 123, name: "Episode", season_number: 1, episode_number: 2, air_date: "2020-01-01", still_path: "/abc.jpg" });
    if (url.includes("/tv/")) return Response.json({ id: 12, name: "Series", genres: [{ name: "Drama" }] });
    return Response.json({ id: 12, title: "Movie", original_title: "Original", release_date: "2020-01-01", poster_path: "/abc.jpg", genres: [] });
  }) as typeof fetch;
  const tmdb = createTmdb(fetcher);
  expect(await tmdb.search("secret", "movie", "Movie & other", new AbortController().signal)).toHaveLength(1);
  const movie = await tmdb.preview("secret", "movie", 12, null, null, new AbortController().signal);
  expect(movie.values.title).toBe("Movie"); expect(movie.artwork?.mimeType).toBe("image/png");
  const episode = await tmdb.preview("secret", "episode", 12, 1, 2, new AbortController().signal);
  expect(episode.match).toMatchObject({ id: 123, seriesId: 12, season: 1, episode: 2 });
  expect(episode.values).toMatchObject({ title: "Episode", showTitle: "Series", genres: ["Drama"] });
  expect(seen.some(call => call.url === "https://image.tmdb.org/t/p/w300/abc.jpg")).toBe(true);
  expect(seen.every(call => call.redirect === "error")).toBe(true);
  expect(seen.filter(call => call.url.includes("api.themoviedb")).every(call => call.auth === "Bearer secret")).toBe(true);
  expect(seen.filter(call => call.url.includes("image.tmdb")).every(call => call.auth === null)).toBe(true);
  expect(seen.every(call => !call.url.includes("secret"))).toBe(true);
  failImage = true;
  await expect(tmdb.preview("secret", "movie", 12, null, null, new AbortController().signal)).rejects.toThrow("artwork");
  tmdb.close();
});


test("match preview applies only after confirmation, fences stale edits and survives a failed subsequent lookup", async () => {
  let failure = false;
  const mock = spyOn(globalThis, "fetch").mockImplementation((async () => failure ? new Response("offline", { status: 503 }) : Response.json({ id: 12, title: "Matched movie", original_title: "Original", release_date: "2020-01-01", genres: [] })) as unknown as typeof fetch);
  cleanup.push(async () => mock.mockRestore());
  const f = await fixture();
  await f.request("provider", { token: "private-read-token" });
  const before = await f.view();
  const previewResponse = await f.request(`items/${f.id}/preview`, { revision: before.revision, id: 12 });
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json();
  expect(await f.view()).toEqual(before);
  expect(JSON.stringify(preview)).not.toContain("private-read-token");
  const result = await f.request(`items/${f.id}/match`, { revision: before.revision, previewId: preview.id });
  expect(result.status).toBe(200);
  expect((await f.view()).match?.id).toBe(12); expect((await f.view()).origins.title).toBe("TMDB");
  const matched = await f.view();
  const nextPreview = await (await f.request(`items/${f.id}/preview`, { revision: matched.revision, id: 12 })).json();
  await f.request(`items/${f.id}/edit`, { revision: matched.revision, changes: { title: "Manual wins" } });
  expect((await f.request(`items/${f.id}/match`, { revision: matched.revision, previewId: nextPreview.id })).status).toBe(409);
  const corrected = await f.view();
  failure = true;
  expect((await f.request(`items/${f.id}/preview`, { revision: corrected.revision, id: 12 })).status).toBe(502);
  await f.library.scan(f.source.id);
  expect((await f.view()).values.title).toBe("Manual wins");
  const now = await f.view();
  expect((await f.request(`items/${f.id}/edit`, { revision: now.revision, changes: {}, clearMatch: true })).status).toBe(200);
  expect((await f.view()).match).toBeNull();
});


test("failed NFO imports retain unknown XML, episode classification and manual order through restart/export", async () => {
  const f = await fixture(true);
  const before = await f.view();
  await f.request(`items/${f.id}/edit`, { revision: before.revision, changes: { season: 2, episode: 4, title: "Correct episode" } });
  for (const broken of ["<episodedetails><broken>", "x".repeat(256 * 1024 + 1), null]) {
    await rm(join(f.media, "sample.nfo"));
    if (broken === null) await symlink(join(f.root, "unreadable.nfo"), join(f.media, "sample.nfo"));
    else await Bun.write(join(f.media, "sample.nfo"), broken);
    expect((await f.library.scan(f.source.id)).warning).toContain("invalid or oversized");
    const view = await f.view();
    expect(view.type).toBe("episode"); expect(view.values).toMatchObject({ season: 2, episode: 4, title: "Correct episode" });
    const response = await f.request(`items/${f.id}/export`, { revision: view.revision });
    expect(response.status).toBe(200);
    const files = await new Bun.Archive(await response.arrayBuffer()).files();
    const xml = await files.get("metadata.nfo")!.text();
    expect(parseVideoNfo(new TextEncoder().encode(xml))).toMatchObject({ type: "episodedetails", fields: { season: "2", episode: "4" } });
    expect(xml).toContain('<unknown attr="a&amp;b">');
    expect(await files.get("original-0.nfo")!.text()).toBe(f.xml);
  }
  await f.library.close();
  const reopened = createLibrary({ databasePath: f.databasePath, folders: f.folders, ffprobePath: null }); cleanup.push(() => reopened.close());
  expect(reopened.getItem(f.id)?.video).toMatchObject({ type: "episode", season: 2, episode: 4 });
});

test("clearing a chosen match suppresses an imported TMDB ID in export and reimport", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ id: 456, title: "New match", release_date: "2020-01-01", genres: [] })) as unknown as typeof fetch);
  cleanup.push(async () => mock.mockRestore());
  const f = await fixture();
  await Bun.write(join(f.media, "sample.nfo"), f.xml.replace("</movie>", '<uniqueid type="tmdb" default="true">123</uniqueid><uniqueid type="imdb">tt123</uniqueid></movie>'));
  await f.library.scan(f.source.id);
  await f.request("provider", { token: "generated-test-token" });
  const before = await f.view();
  const preview = await (await f.request(`items/${f.id}/preview`, { revision: before.revision, id: 456 })).json();
  await f.request(`items/${f.id}/match`, { revision: before.revision, previewId: preview.id });
  const matched = await f.view();
  expect(matched.match?.id).toBe(456);
  expect((await f.request(`items/${f.id}/edit`, { revision: matched.revision, clearMatch: true })).status).toBe(200);
  await f.library.scan(f.source.id);
  const cleared = await f.view();
  expect(cleared.match).toBeNull();
  const files = await new Bun.Archive(await (await f.request(`items/${f.id}/export`, { revision: cleared.revision })).arrayBuffer()).files();
  const xml = await files.get("metadata.nfo")!.text();
  expect(xml).not.toContain('type="tmdb"'); expect(xml).toContain('type="imdb"');
  await Bun.write(join(f.media, "sample.nfo"), xml); await f.library.scan(f.source.id);
  const reexport = await new Bun.Archive(await (await f.request(`items/${f.id}/export`, { revision: (await f.view()).revision })).arrayBuffer()).files();
  expect(await reexport.get("metadata.nfo")!.text()).not.toContain('type="tmdb"');
});


test("a failed episode NFO never promotes its manual series title into a sibling's imported metadata", async () => {
  const f = await fixture(true, true);
  await Bun.write(join(f.media, "tvshow.nfo"), '<tvshow><title>Imported series</title><unknown>Keep show field</unknown></tvshow>');
  await Bun.write(join(f.media, "z-sibling.mkv"), "other episode fixture");
  await Bun.write(join(f.media, "z-sibling.nfo"), '<episodedetails><title>Sibling</title><season>1</season><episode>8</episode></episodedetails>');
  await f.library.scan(f.source.id);
  const sibling = f.library.search({ videoType: "episode" }).items.find(item => item.id !== f.id)!;
  const readSibling = async (): Promise<MetadataView> => (await f.request(`items/${sibling.id}`)).json();
  const before = await readSibling();
  const current = await f.view();
  expect((await f.request(`items/${f.id}/edit`, { revision: current.revision, changes: { showTitle: "Manual episode series" } })).status).toBe(200);
  await Bun.write(join(f.media, `${f.filename}.nfo`), "<episodedetails><broken>");
  expect((await f.library.scan(f.source.id)).status).toBe("ready");
  expect((await f.view()).values.showTitle).toBe("Manual episode series");
  expect((await f.view()).origins.showTitle).toBe("Manual");
  const after = await readSibling();
  expect(after.values.showTitle).toBe("Imported series");
  expect(after.origins.showTitle).toBe(before.origins.showTitle);
  expect(after.revision).toBe(before.revision);
  const files = await new Bun.Archive(await (await f.request(`items/${sibling.id}/export`, { revision: after.revision })).arrayBuffer()).files();
  expect(await files.get("show.nfo")!.text()).toContain("<title>Imported series</title>");
  expect(await files.get("show.nfo")!.text()).not.toContain("Manual episode series");
  expect(await files.get("metadata.nfo")!.text()).toContain("<showtitle>Imported series</showtitle>");
});


test("standalone artwork corrections need no placeholder changes object", async () => {
  const f = await fixture();
  const before = await f.view();
  expect((await f.request(`items/${f.id}/edit`, { revision: before.revision, artwork: cover.toString("base64") })).status).toBe(200);
  const after = await f.view();
  expect(after.values.title).toBe(before.values.title);
  expect(after.values.artworkId).not.toBeNull();
  expect(after.origins.artworkId).toBe("Manual");
});

test("an episode's imported show-poster fallback exports back to the show folder", async () => {
  const f = await fixture(true);
  await Bun.write(join(f.media, "poster.png"), cover);
  await f.library.scan(f.source.id);
  const current = await f.view();
  const exported = await new Bun.Archive(await (await f.request(`items/${f.id}/export`, { revision: current.revision })).arrayBuffer()).files();
  expect(JSON.parse(await exported.get("placement.json")!.text()).placements["artwork-0.png"]).toBe("poster.png in the original show folder");
  const imported = join(f.root, "poster-reimport"); await mkdir(imported);
  await Bun.write(join(imported, "sample.mkv"), "episode fixture");
  await Bun.write(join(imported, "sample.nfo"), exported.get("metadata.nfo")!);
  await Bun.write(join(imported, "tvshow.nfo"), exported.get("show.nfo")!);
  await Bun.write(join(imported, "poster.png"), exported.get("artwork-0.png")!);
  const source = await f.library.addSource(imported); await f.library.scan(source.id);
  const episode = f.library.search().items.find(item => item.id !== f.id)!;
  expect(episode.video?.show?.artworkId).toBe(current.values.artworkId);
  expect(episode.artworkId).toBe(current.values.artworkId);
  // Explicitly choosing the same image makes it an episode correction instead.
  expect((await f.request(`items/${f.id}/edit`, { revision: (await f.view()).revision, artwork: cover.toString("base64") })).status).toBe(200);
  const manual = await new Bun.Archive(await (await f.request(`items/${f.id}/export`, { revision: (await f.view()).revision })).arrayBuffer()).files();
  expect(JSON.parse(await manual.get("placement.json")!.text()).placements["artwork-0.png"]).toBe("sample-thumb.png");
});

test("each failed NFO retains its own snapshot while the other sidecar can update", async () => {
  const f = await fixture(true);
  const originalShow = '<tvshow><title>Original series</title><unknown>Original show field</unknown></tvshow>';
  await Bun.write(join(f.media, "tvshow.nfo"), originalShow); await f.library.scan(f.source.id);
  await f.request(`items/${f.id}/edit`, { revision: (await f.view()).revision, changes: { title: "Manual title" } });
  const updatedEpisode = '<episodedetails><title>Updated imported title</title><plot>Updated plot</plot><season>2</season><episode>3</episode><unknown>Updated episode field</unknown></episodedetails>';
  await Bun.write(join(f.media, "sample.nfo"), updatedEpisode);
  await Bun.write(join(f.media, "tvshow.nfo"), '<tvshow><broken>');
  await f.library.scan(f.source.id);
  expect((await f.view()).values).toMatchObject({ title: "Manual title", showTitle: "Original series", plot: "Updated plot", season: 2, episode: 3 });
  let exported = await new Bun.Archive(await (await f.request(`items/${f.id}/export`, { revision: (await f.view()).revision })).arrayBuffer()).files();
  expect(await exported.get("metadata.nfo")!.text()).toContain("Updated episode field");
  expect(await exported.get("show.nfo")!.text()).toContain("Original show field");
  expect(await exported.get("original-0.nfo")!.text()).toBe(updatedEpisode);
  await Bun.write(join(f.media, "sample.nfo"), '<episodedetails><broken>');
  await Bun.write(join(f.media, "tvshow.nfo"), '<tvshow><title>Updated series</title><unknown>Updated show field</unknown></tvshow>');
  await f.library.scan(f.source.id);
  const current = await f.view();
  expect(current.type).toBe("episode");
  expect(current.values).toMatchObject({ title: "Manual title", showTitle: "Updated series", plot: "Updated plot", season: 2, episode: 3 });
  expect(current.origins.showTitle).toBe("Imported/local"); expect(current.origins.title).toBe("Manual");
  exported = await new Bun.Archive(await (await f.request(`items/${f.id}/export`, { revision: current.revision })).arrayBuffer()).files();
  expect(await exported.get("metadata.nfo")!.text()).toContain("Updated episode field");
  expect(await exported.get("show.nfo")!.text()).toContain("Updated show field");
  expect(await exported.get("original-0.nfo")!.text()).toBe(updatedEpisode);
});
