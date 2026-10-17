import { expect, mock, test } from "bun:test";
// The results page needs a browser; its route's redirect doesn't.
mock.module("../src/client/sections/find/SearchPage", () => ({ SearchPage: () => null }));
const { Route: search } = await import("../src/client/routes/search");
import { Route as find } from "../src/client/routes/find";
import { Route as live } from "../src/client/routes/live";
import { Route as library } from "../src/client/routes/library";
import { Route as whereItPlays } from "../src/client/routes/where-it-plays";
import { frontendPaths, pagePaths, pathForSection, sectionForPath } from "../src/shared/page-paths";
import { detailHref } from "../src/client/detail-navigation";

type Redirecting = { options: { beforeLoad?: unknown } };
function open(route: Redirecting, searchStr: string) {
  try { (route.options.beforeLoad as (context: unknown) => void)({ location: { pathname: "/", searchStr } }); }
  catch (redirect) { return (redirect as { options: { href: string } }).options.href; }
}

test("The sections are Home, Discover and Saved, then Remote and Settings; Search is the header's field", () => {
  expect(Object.keys(pagePaths).slice(0, 5)).toEqual(["Home", "Discover", "Saved", "Remote", "Settings"]);
  expect(sectionForPath("/discover")).toBe("Discover");
  expect(sectionForPath("/saved")).toBe("Saved");
  expect(sectionForPath("/search")).toBe("Search");
  // Discover's own pages belong to it.
  expect(sectionForPath("/discover/radio")).toBe("Discover");
  expect(sectionForPath("/discover/live-tv")).toBe("Discover");
});

test("An empty search is Discover; a query stays on its results", () => {
  expect(open(search, "")).toBe("/discover");
  expect(open(search, "?source=YouTube")).toBe("/discover");
  expect(open(search, "?q=jazz")).toBeUndefined();
});

test("Live opens Discover, and Library opens Saved on the same tab", () => {
  expect(open(live, "")).toBe("/discover");
  expect(open(live, "?radioSource=Radio+directory")).toBe("/discover");
  expect(open(library, "")).toBe("/saved");
  expect(open(library, "?tab=channels")).toBe("/saved?tab=channels");
});

test("Find's addresses open Search with their query, and its Radio and Live TV open Discover's pages", () => {
  expect(open(find, "")).toBe("/search");
  expect(open(find, "?q=jazz&source=YouTube")).toBe("/search?q=jazz&source=YouTube");
  expect(open(find, "?browse=radio")).toBe("/discover/radio");
  expect(open(find, "?browse=radio&radioSource=Radio+playlists&page=2")).toBe("/discover/radio?radioSource=Radio+playlists&page=2");
  expect(open(find, "?browse=live-tv&group=News&page=3&filter=rai")).toBe("/discover/live-tv?group=News&page=3&filter=rai");
});

test("Where it plays' overview became the picker alone, so its address opens Home", () => {
  expect(open(whereItPlays, "")).toBe("/");
  expect(sectionForPath("/where-it-plays")).toBeUndefined();
});

test("Core serves the sections, Discover's pages and the earlier addresses that redirect to them", () => {
  for (const path of ["/discover", "/discover/radio", "/discover/live-tv", "/saved", "/search", "/live", "/library", "/where-it-plays", "/find"]) expect(frontendPaths).toContain(path);
  expect(sectionForPath("/saved/")).toBe("Saved");
  expect(sectionForPath("/collection")).toBe("Discover");
  expect(pathForSection("For later")).toBe("/saved");
});

test("an item or collection page keeps the section that opened it, as its URL says", () => {
  expect(sectionForPath("/item", "?kind=saved&id=x&from=saved")).toBe("Saved");
  expect(sectionForPath("/collection", "?provider=youtube&url=&from=home")).toBe("Home");
  expect(sectionForPath("/item", "?kind=radio&id=x&from=search")).toBe("Search");
  expect(sectionForPath("/item", "?kind=radio&id=x")).toBe("Discover");
  expect(sectionForPath("/item", "?kind=saved&id=x&from=settings")).toBe("Discover");
});

test("a detail link carries the section it renders in, so a new tab opens there too", () => {
  const page = globalThis as { location?: unknown };
  page.location = { pathname: "/saved", search: "?tab=lists" };
  try {
    expect(detailHref("/item?kind=saved&id=x")).toBe("/item?kind=saved&id=x&from=saved");
    expect(detailHref("/item?kind=saved&id=x&from=home")).toBe("/item?kind=saved&id=x&from=home");
  } finally { delete page.location; }
  expect(detailHref("/item?kind=saved&id=x")).toBe("/item?kind=saved&id=x");
  page.location = { pathname: "/discover/radio", search: "" };
  try { expect(detailHref("/item?kind=radio&id=x")).toBe("/item?kind=radio&id=x&from=discover"); }
  finally { delete page.location; }
});
