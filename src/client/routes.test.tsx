import { expect, test } from "bun:test";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { readSearchState, searchLocation } from "./search";
import { frontendPaths } from "../shared/page-paths";

test("every frontend path resolves to a registered route", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient(), identity: null, connected: false }, history: createMemoryHistory({ initialEntries: ["/"] }) });
  const ids = Object.keys(router.routesById);
  for (const path of frontendPaths) expect(ids).toContain(path);
});

test("malformed search filters use truthful defaults", () => {
  expect(readSearchState("?q=a%26b&source=Unknown")).toEqual({ query: "a&b", source: "All" });
  expect(searchLocation({ query: "", source: "All" })).toBe("/find");
  expect(readSearchState("?source=TV%20folders").source).toBe("Folders");
});

test("Up next can open directly and close without adding a history entry", async () => {
  const history = createMemoryHistory({ initialEntries: ["/find", "/now?queue=true"] });
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient(), identity: null, connected: false }, history });
  await router.load();
  expect(router.state.matches.at(-1)?.search).toMatchObject({ queue: true });
  const closed = router.buildLocation({ to: "/now", search: {} });
  expect(closed.href).toBe("/now");
  history.replace(closed.href);
  history.back();
  expect(history.location.pathname).toBe("/find");
});
