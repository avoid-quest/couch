import { expect, test } from "bun:test";
import { readSearchState, searchLocation, searchRelevance } from "../src/client/search";

test("search links carry a kind and a source, and drop what Search no longer reads", () => {
  expect(readSearchState("?q=jazz&kind=music&source=Bandcamp")).toEqual({ query: "jazz", kind: "music", source: "Bandcamp" });
  expect(readSearchState({ q: "jazz", kind: "Music", until: "23:00", length: "Over 1 hr" })).toEqual({ query: "jazz", source: "All" });
  expect(searchLocation({ query: "jazz", kind: "films", source: "StreamingCommunity" })).toBe("/search?q=jazz&kind=films&source=StreamingCommunity");
  expect(searchLocation({ query: "jazz", kind: undefined, source: "All" })).toBe("/search?q=jazz");
});

test("one-character words participate in close and strong matches", () => {
  const x = searchRelevance("x");
  expect(x.close({ title: "Unrelated", meta: "YouTube" })).toBe(false);
  expect(x.strong({ title: "X" })).toBe(true);
  const query = searchRelevance("a b");
  expect(query.strong({ title: "A beautiful day" })).toBe(true);
  expect(query.close({ title: "Radio", meta: "NTS" })).toBe(false);
  expect(searchRelevance("nts").close({ title: "Quints", meta: "" })).toBe(false);
  expect(searchRelevance("café").strong({ title: "Cafe\u0301 live" })).toBe(true);
});

test("radio relevance includes metadata omitted from its caption, without matching the next show", () => {
  const hit = { title: "NTS Radio", meta: "Early Bird, Jazz", radio: { id: "station", title: "NTS Radio", url: "https://example.com/radio", host: "Alex", tags: ["Talk"], categories: ["Experimental"], group: "Community network", next: { start: 0, title: "Afternoon selections" } } };
  for (const query of ["Alex", "Talk", "Experimental", "Community"]) expect(searchRelevance(query).close(hit)).toBe(true);
  expect(searchRelevance("Alex").strong(hit)).toBe(false);
  expect(searchRelevance("Afternoon").close(hit)).toBe(false);
});
