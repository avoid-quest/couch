// On an empty Vite page, import this module and call runDetailsPendingRegression().
// Pressing Play on Details opens the player; while the player's route is pending, the location already names it, and
// a page that read the location turned into "Item not found" for that moment. Details and collection pages read their
// own match's search (useOwnSearch), which keeps naming them until the next page has loaded.
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { useOwnSearch } from "../src/client/detail-navigation";
import { readItemSearch } from "../src/client/sections/details/ItemPage";
import { readCollectionSearch } from "../src/client/collection-pagination";

const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

async function check(path: string, read: (search: Record<string, unknown>) => unknown, names: (search: unknown) => boolean) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const seen: unknown[] = [];
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  function Page() { const search = useOwnSearch(read); seen.push(search); return <p>{names(search) ? "named" : "Item not found"}</p>; }
  const rootRoute = createRootRoute({ component: Outlet });
  const page = createRoute({ getParentRoute: () => rootRoute, path: path.split("?")[0]!, component: Page });
  // The player's route takes its time, as a cold player chunk does.
  const player = createRoute({ getParentRoute: () => rootRoute, path: "/now", loader: () => loading, component: () => <p>Player</p> });
  const router = createRouter({ routeTree: rootRoute.addChildren([page, player]), history: createMemoryHistory({ initialEntries: [path] }), defaultPendingMs: 10_000 });
  root.render(<RouterProvider router={router} />);
  await wait(200);
  assert(host.textContent === "named", `${path} should name its item before Play: ${host.textContent}`);
  const navigation = router.navigate({ to: "/now" });
  await wait(200);
  assert(router.state.location.pathname === "/now", "the check needs the location to have moved on while the player is pending");
  assert(host.textContent === "named", `${path} turned into "${host.textContent}" while the player was pending`);
  assert(seen.every(names), `${path} read a search that names nothing while the player was pending`);
  release();
  await navigation;
  await wait(100);
  assert(host.textContent === "Player", "the player should open once it has loaded");
  root.unmount();
  host.remove();
}

export async function runDetailsPendingRegression() {
  await check("/item?kind=history&id=media%3Aabc", readItemSearch, search => !!(search as ReturnType<typeof readItemSearch>).id);
  await check("/collection?provider=youtube&url=https%3A%2F%2Fwww.youtube.com%2F%40blender", readCollectionSearch, search => !!(search as ReturnType<typeof readCollectionSearch>).provider);
  return "Details and collection pages keep their item while the player is pending";
}
