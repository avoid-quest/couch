import { expect, test } from "bun:test";
import { canReturn, readSearchState, searchLocation, sourceKinds, searchSources } from "../src/client/search";
import { chooseScope, completeScope, dropScope, matchScopes, scopeLabels, scopes, suggest, type SearchScope } from "../src/client/search-palette";

const scope = (label: string) => scopes.find(item => item.label === label)!;
const all: SearchScope = { source: "All" };

test("Tab completes a scope's name or short form, exact names first, from two letters", () => {
  expect(completeScope("film")?.kind).toBe("films");
  expect(completeScope("Live")?.kind).toBe("live");
  expect(completeScope("yt")?.source).toBe("YouTube");
  expect(completeScope("radio")?.kind).toBe("radio");
  expect(completeScope("rai")?.source).toBe("RaiPlay");
  expect(completeScope("band")?.source).toBe("Bandcamp");
  expect(completeScope("anime unity")?.source).toBe("AnimeUnity");
  expect(completeScope("y")).toBeUndefined();
  expect(completeScope("yt jazz")).toBeUndefined();
  expect(matchScopes("ra").map(item => item.label)).toEqual(["Radio", "RaiPlay", "Radio playlists", "Radio directory"]);
});

test("choosing a scope never makes an impossible combination, and choosing it again removes it", () => {
  expect(chooseScope(all, scope("Music"))).toEqual({ kind: "music", source: "All" });
  expect(chooseScope({ kind: "music", source: "All" }, scope("Bandcamp"))).toEqual({ kind: "music", source: "Bandcamp" });
  // Bandcamp has no films, so Films drops it; YouTube has no music, so it drops Music.
  expect(chooseScope({ kind: "music", source: "Bandcamp" }, scope("Films & series"))).toEqual({ kind: "films", source: "All" });
  expect(chooseScope({ kind: "music", source: "All" }, scope("YouTube"))).toEqual({ kind: undefined, source: "YouTube" });
  expect(chooseScope({ kind: "live", source: "All" }, scope("YouTube"))).toEqual({ kind: "live", source: "YouTube" });
  expect(chooseScope({ kind: "live", source: "YouTube" }, scope("Live"))).toEqual({ source: "YouTube" });
  expect(chooseScope({ kind: "live", source: "YouTube" }, scope("YouTube"))).toEqual({ kind: "live", source: "All" });
});

test("Backspace takes the source, then the kind; the tokens read kind first", () => {
  const both: SearchScope = { kind: "music", source: "SoundCloud" };
  expect(scopeLabels(both)).toEqual(["Music", "SoundCloud"]);
  expect(dropScope(both)).toEqual({ kind: "music", source: "All" });
  expect(dropScope({ kind: "music", source: "All" })).toEqual({ source: "All" });
  expect(scopeLabels(all)).toEqual([]);
});

test("the field's token is the URL's kind and source, both ways", () => {
  const state = readSearchState("?q=jazz&kind=music&source=Bandcamp");
  expect(scopeLabels(state)).toEqual(["Music", "Bandcamp"]);
  const next = chooseScope(state, scope("SoundCloud"));
  expect(searchLocation({ ...state, ...next })).toBe("/search?q=jazz&kind=music&source=SoundCloud");
  expect(searchLocation({ ...state, ...dropScope(dropScope(state)) })).toBe("/search?q=jazz");
  // Every scope the palette offers survives the URL.
  for (const item of scopes) {
    const chosen = chooseScope(all, item);
    expect(readSearchState(searchLocation({ query: "x", ...chosen }).slice("/search".length))).toEqual({ query: "x", ...chosen.kind ? { kind: chosen.kind } : {}, source: chosen.source });
  }
});

test("every source has the kinds it can return, and a kind only asks those", () => {
  for (const source of searchSources.filter(source => source !== "All")) expect(sourceKinds[source]?.length).toBeGreaterThan(0);
  expect(canReturn("AnimeSaturn", "music")).toBe(false);
  expect(canReturn("Radio directory", "films")).toBe(false);
  expect(canReturn("Radio directory", "radio")).toBe(true);
  expect(canReturn("YouTube", "live")).toBe(true);
  expect(canReturn("YouTube")).toBe(true);
  expect(canReturn("All", "films")).toBe(true);
  expect(searchSources.filter(source => source !== "All" && canReturn(source, "audio"))).toEqual(["YouTube", "Bandcamp", "SoundCloud"]);
  expect(chooseScope({ kind: "audio", source: "All" }, scope("YouTube"))).toEqual({ kind: "audio", source: "YouTube" });
  expect(scopeLabels(readSearchState("?q=artist+song&kind=audio"))).toEqual(["Audio"]);
});

test("suggestions come only from what the client holds, narrowed by the scope", () => {
  const held = {
    recents: ["jazz piano", "jazz", "rock"],
    saved: [{ title: "Jazz Cabbage", source: "SoundCloud" }, { title: "Episodio 1", context: "Jazz Age", source: "RaiPlay" }],
    played: [{ title: "Jazz Cabbage", source: "SoundCloud" }, { title: "Late jazz", source: "YouTube" }],
    stations: [{ name: "Jazz FM" }, { name: "Jazz FM" }, { name: "NTS" }],
  };
  const found = suggest("jazz", all, held);
  expect(found.recents).toEqual(["jazz piano"]);
  expect(found.saved.map(item => item.title)).toEqual(["Jazz Cabbage", "Episodio 1"]);
  // A title already suggested as saved isn't suggested again as played.
  expect(found.played.map(item => item.title)).toEqual(["Late jazz"]);
  expect(found.stations.map(station => station.name)).toEqual(["Jazz FM"]);
  expect(suggest("jazz", { kind: "radio", source: "All" }, held)).toMatchObject({ saved: [], played: [], stations: [{ name: "Jazz FM" }] });
  expect(suggest("jazz", { kind: "music", source: "SoundCloud" }, held)).toMatchObject({ saved: [{ title: "Jazz Cabbage" }], played: [], stations: [] });
  expect(suggest("jazz", { kind: "audio", source: "All" }, held)).toMatchObject({ saved: [{ title: "Jazz Cabbage" }], played: [{ title: "Late jazz" }], stations: [] });
  expect(suggest("yt", all, held).scopes.map(item => item.label)).toEqual(["YouTube"]);
});
