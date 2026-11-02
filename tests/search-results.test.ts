import { expect, test } from "bun:test";
import { searchRelevance } from "../src/client/search";

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
  const hit = { title: "NTS Radio", meta: "Early Bird, Jazz", radio: { id: "station", title: "NTS Radio", url: "https://example.com/radio", host: "Alex", tags: ["Talk"], categories: ["Experimental"], group: "Community network", next: { start: 0, title: "Afternoon selections" } } };
  for (const query of ["Alex", "Talk", "Experimental", "Community"]) expect(searchRelevance(query).close(hit)).toBe(true);
  expect(searchRelevance("Alex").strong(hit)).toBe(false);
  expect(searchRelevance("Afternoon").close(hit)).toBe(false);
});
