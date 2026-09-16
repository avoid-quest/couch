import { expect, test } from "bun:test";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { readSearchState, searchLocation } from "./search";
import { frontendPaths } from "../shared/page-paths";

test("every frontend path resolves to a registered route", () => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) });
  const ids = Object.keys(router.routesById);
  for (const path of frontendPaths) expect(ids).toContain(path);
});

test("malformed search filters use truthful defaults", () => {
  expect(readSearchState("?q=a%26b&source=Unknown")).toEqual({ query: "a&b", source: "All" });
  expect(searchLocation({ query: "", source: "All" })).toBe("/find");
});
