import { expect, test } from "bun:test";
import { keepShown, mergeSearchHits, searchRelevance } from "../src/client/search";
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
const titles = (hits: SearchHit[]) => hits.map((each) => each.title);

test("hits rank by title strength, then the sources take turns, then each source's order", () => {
  const merged = mergeSearchHits(
    ["YouTube", "SoundCloud"],
    {
      YouTube: [hit("YouTube", "DJ set"), hit("YouTube", "Alé dj mix"), hit("YouTube", "Other")],
      SoundCloud: [hit("SoundCloud", "Something"), hit("SoundCloud", "DJ Alé")],
    },
    "dj ale",
  );
  expect(titles(merged)).toEqual(["DJ Alé", "Alé dj mix", "DJ set", "Something", "Other"]);
});

test("hits shown up to the focused one keep their places when more arrive", () => {
  const first = [hit("A", "one"), hit("A", "two"), hit("A", "three")];
  const shown = first.map((each) => each.id);
  const later = [hit("B", "best"), ...first, hit("B", "worst")];
  expect(titles(keepShown(shown, later, "A:two"))).toEqual([
    "one",
    "two",
    "best",
    "three",
    "worst",
  ]);
  expect(titles(keepShown(shown, later, null))).toEqual(titles(later));
  expect(titles(keepShown(shown, later.slice(2), "A:two"))).toEqual(["two", "three", "worst"]);
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
