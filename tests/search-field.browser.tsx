// On an empty page served by Vite, import this module and call runSearchFieldRegression().
// Uses a memory router and fixture contexts; never contacts Core or edits installed Couch data.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderSearch } from "../src/client/sections/shell/HeaderSearch";
import { ShellContext } from "../src/client/sections/shell/shell-context";
import type { ShellValue } from "../src/client/sections/shell/AppShell";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";

const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
export async function runSearchFieldRegression() {
  const host = document.getElementById("fixture") ?? document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const client = new QueryClient();
  const recentKey = "couch.search-recents:search-regression";
  const savedRecents = localStorage.getItem(recentKey);
  localStorage.setItem(recentKey, JSON.stringify(["Recent query"]));
  let setScope: (value: string | null) => void = () => {};
  const gate = { connected: true, credentials: { installationId: "search-regression", origin: location.origin, token: "fixture" } } as SessionGateValue;
  function Fixture() {
    const [searchScope, setSearchScope] = useState<string | null>(null);
    setScope = setSearchScope;
    return <SessionGateContext value={gate}><QueryClientProvider client={client}><ShellContext value={{ searchScope, setSearchScope } as ShellValue}><HeaderSearch /><main data-page tabIndex={-1}>Results</main></ShellContext></QueryClientProvider></SessionGateContext>;
  }
  const rootRoute = createRootRoute({ component: Fixture });
  const routeTree = rootRoute.addChildren(["search", "discover", "saved"].map(path => createRoute({ getParentRoute: () => rootRoute, path })));
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/search?q=old"] }) });
  const field = () => host.querySelector<HTMLInputElement>("#media-search")!;
  const input = async (value: string) => {
    field().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
  };
  const navigate = async (href: string) => { await router.navigate({ href }); await wait(); };
  const query = () => new URLSearchParams(router.state.location.searchStr).get("q");
  try {
    root.render(<RouterProvider router={router} />);
    await wait(250);
    await input("draft before composition");
    field().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await input("日本");
    await wait(600);
    assert(query() === "old", "IME draft escaped during composition");
    field().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await wait(650);
    assert(query() === "日本", `Completed IME query never searched: ${router.state.location.href}, input=${field().value}, busy=${host.querySelector("form")?.getAttribute("aria-busy")}`);
    await input("");
    const recent = [...host.querySelectorAll<HTMLButtonElement>("[data-search-recents] button")].find(button => button.textContent === "Recent query")!;
    assert(recent, "Recent choices did not appear after clearing the field");
    let submits = 0;
    const form = host.querySelector("form")!;
    const onSubmit = () => { submits++; };
    form.addEventListener("submit", onSubmit);
    recent.click();
    await wait(650);
    assert(submits === 0 && query() === "Recent query", "Recent choice submitted the form or lost its query");
    form.removeEventListener("submit", onSubmit);
    await input("stale");
    await navigate("/saved");
    await wait(600);
    assert(router.state.location.pathname === "/saved" && field().value === "", "Pending query hijacked section navigation");
    await navigate("/search?q=first");
    await input("stale history draft");
    await navigate("/search?q=second&source=YouTube");
    await wait(600);
    assert(query() === "second", "Pending query hijacked query/history navigation");
    await navigate("/discover");
    await input("old provider draft");
    setScope("Bandcamp");
    await wait(650);
    assert(router.state.location.pathname === "/discover", "Pending draft searched under a newly selected provider");
    assert(host.querySelector("form")?.getAttribute("aria-busy") === "false", "Cancelled search left a permanent busy indicator");
    await navigate("/search?q=x");
    const page = host.querySelector<HTMLElement>("main")!;
    page.focus(); page.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true, cancelable: true }));
    await wait(650);
    assert(query() === "xy", "Type-to-search edited the draft without scheduling it");
    await input("");
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await wait();
    assert(document.activeElement?.closest("[data-search-recents]"), "Down did not reach recents");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await wait();
    assert(document.activeElement === field(), "Escape did not return from recents to the input");
    return { passed: true, checks: ["IME cancellation and completion", "recents never submit", "section navigation cancels", "query navigation cancels", "scope changes cancel", "busy indicator settles", "type-to-search schedules", "recents keyboard focus"] };
  } finally {
    root.unmount(); client.clear();
    if (savedRecents === null) localStorage.removeItem(recentKey); else localStorage.setItem(recentKey, savedRecents);
  }
}
