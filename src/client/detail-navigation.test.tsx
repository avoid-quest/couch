import { setupUiTests, act, render, screen, userEvent, waitFor } from "@/testing/react";
import { expect, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { DetailFocusRestoration, itemLocation, useDetailNavigation } from "./detail-navigation";

setupUiTests();

async function mount(initial = "/find?q=night&source=Folders&kind=Video") {
  function Find() {
    const navigation = useDetailNavigation();
    return <>{["first", "second"].map(id => <button key={id} aria-label="Details Night" onClick={() => navigation.open(itemLocation("library", id))}>Details</button>)}</>;
  }
  function Item() {
    const navigation = useDetailNavigation();
    return <section data-page="Item"><button data-back onClick={() => navigation.back()}>Back</button></section>;
  }
  const base = createRootRoute({ component: () => <><DetailFocusRestoration /><Outlet /></> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: Find });
  const item = createRoute({ getParentRoute: () => base, path: "/item", component: Item });
  const history = createMemoryHistory({ initialEntries: [initial] });
  const router = createRouter({ routeTree: base.addChildren([find, item]), history });
  const view = render(<></>);
  await act(async () => { await router.load(); view.rerender(<RouterProvider router={router} />); });
  return { history };
}

test("browser Back restores the exact opener and full search URL", async () => {
  const { history } = await mount();
  await userEvent.click(screen.getAllByRole("button", { name: "Details Night" })[1]!);
  await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).toHaveFocus());
  expect(history.location.href).toBe(itemLocation("library", "second"));
  await act(async () => history.back());
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Details Night" })[1]!).toHaveFocus());
  expect(history.location.href).toBe("/find?q=night&source=Folders&kind=Video");
  history.destroy();
});

test("a directly opened item falls back to Find without leaving Couch", async () => {
  const { history } = await mount(itemLocation("library", "direct"));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findAllByRole("button", { name: "Details Night" });
  expect(history.location.pathname).toBe("/find");
  expect(history.canGoBack()).toBe(false);
  history.destroy();
});
