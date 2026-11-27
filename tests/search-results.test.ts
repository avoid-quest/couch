import { expect, test } from "bun:test";
import { foldCopies, searchRelevance } from "../src/client/search";
import { completeScope } from "../src/client/search-palette";
import type { SearchHit } from "../src/client/sections/find/SearchOnlineResults";
import { radioMatches, type RadioStation } from "../src/shared/radio";
import { fold, searchWords } from "../src/shared/search-text";

test("one-character words participate in close and strong matches", () => {
  const x = searchRelevance("x");
  expect(x.close({ title: "Unrelated", meta: "YouTube" })).toBe(false);
  expect(x.strong({ title: "X" })).toBe(true);
  const query = searchRelevance("a b");
  expect(query.strong({ title: "A beautiful day" })).toBe(true);
  expect(query.close({ title: "Radio", meta: "NTS" })).toBe(false);
  expect(searchRelevance("nts").close({ title: "Quints", meta: "" })).toBe(false);
  expect(searchRelevance("café").strong({ title: "Café live" })).toBe(true);
});

test("radio relevance includes metadata omitted from its caption, without matching the next show", () => {
  const hit = {
    title: "NTS Radio",
    meta: "Early Bird, Jazz",
    radio: {
      id: "station",
      title: "NTS Radio",
      url: "https://example.com/radio",
      host: "Alex",
      tags: ["Talk"],
      categories: ["Experimental"],
      group: "Community network",
      next: { start: 0, title: "Afternoon selections" },
    },
  };
  for (const query of ["Alex", "Talk", "Experimental", "Community"])
    expect(searchRelevance(query).close(hit)).toBe(true);
  expect(searchRelevance("Alex").strong(hit)).toBe(false);
  expect(searchRelevance("Afternoon").close(hit)).toBe(false);
});

test("case and accents fold, so a plain query finds an accented title", () => {
  expect(fold("DJ Alé")).toBe("dj ale");
  expect(searchWords("Ghettology #3 – DJ ALÉ")).toEqual(["ghettology", "3", "dj", "ale"]);
  expect(searchRelevance("dj ale").strong({ title: "DJ Alé" })).toBe(true);
  expect(searchRelevance("DJ alé").strong({ title: "dj ale live" })).toBe(true);
  expect(completeScope("Ràdio")?.label).toBe("Radio");
});

test("title strength: the query itself, then every word, then some word", () => {
  const { strength } = searchRelevance("dj ale");
  expect(strength("DJ Alé")).toBe(3);
  expect(strength("DJ Alé (One Off Lyon)")).toBe(2);
  expect(strength("Alessandro's DJ set")).toBe(2);
  expect(strength("DJ Spel")).toBe(1);
  expect(strength("Ghettology")).toBe(0);
});

const hit = (source: string, title: string) =>
  ({ id: `${source}:${title}`, source, title }) as unknown as SearchHit;

test("the same recording from several sources shows once, with the others in its meta", () => {
  const episode = {
    ...hit("Radio archives", "DJ Alé"),
    url: "https://lyl.live/episode/dj-ale",
    duration: 3600,
    copies: [
      "https://www.mixcloud.com/lylradio/dj-al%C3%A9-dj-al%C3%A9-22102026/",
      "https://soundcloud.com/lyl_radio/dj-ale",
    ],
  };
  const mixcloud = {
    ...hit("Mixcloud", "DJ Alé - DJ Alé (22.10.2026)"),
    url: "https://www.mixcloud.com/lylradio/dj-alé-dj-alé-22102026/",
  };
  const soundcloud = {
    ...hit("SoundCloud", "DJ Alé"),
    url: "https://soundcloud.com/lyl_radio/dj-ale?utm_source=x",
  };
  const upload = { ...hit("YouTube", "dj ale"), url: "https://youtu.be/x", duration: 3630 };
  const other = { ...hit("YouTube", "DJ Alé"), url: "https://youtu.be/y", duration: 1800 };
  const folded = foldCopies([episode, mixcloud, soundcloud, upload, other]);
  expect(folded.map((each) => [each.source, each.also])).toEqual([
    ["Radio archives", ["Mixcloud", "SoundCloud", "YouTube"]],
    ["YouTube", undefined],
  ]);
  expect(folded[1]!.url).toBe("https://youtu.be/y");
  // The station's own episode stands for its copies, even when a copy came first.
  expect(
    foldCopies([mixcloud, episode, soundcloud]).map((each) => [each.source, each.also]),
  ).toEqual([["Radio archives", ["Mixcloud", "SoundCloud"]]]);
});

test("a station matches every word of the query in any order, accents folded", () => {
  const station = { id: "lyl", name: "Lyl Radio", url: "https://example.com/live" } as RadioStation;
  const show = { title: "DJ Alé", artist: "DJ Alé", categories: ["Baile Funk"] };
  expect(radioMatches(station, "dj ale", show)).toBe(true);
  expect(radioMatches(station, "ale lyl", show)).toBe(true);
  expect(radioMatches(station, "funk ALÉ", show)).toBe(true);
  expect(radioMatches(station, "dj spel", show)).toBe(false);
  expect(radioMatches(station, "dj ale")).toBe(false);
});

test("a hit by the searched artist or from the searched album counts as close", () => {
  const { close } = searchRelevance("devi tensione");
  expect(
    close({
      title: "Verme",
      creator: { title: "Devi Tensione", url: "https://open.spotify.com/artist/x" },
    }),
  ).toBe(true);
  expect(
    close({
      title: "Tendo #1",
      context: { title: "Devi Tensione Live", url: "https://example.com/a" },
    }),
  ).toBe(true);
  expect(close({ title: "Verme" })).toBe(false);
});
