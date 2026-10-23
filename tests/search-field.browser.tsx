// On an empty page served by Vite, import this module and call runSearchFieldRegression().
// Uses a memory router and fixture APIs; never contacts Core or edits installed Couch data.
// Run with ?tv=1 as well to exercise remote Send, Clear and Enter through connectRemoteText.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useLocation } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SearchPanel } from "../src/client/sections/find/SearchPanel";
import { readSearchState, searchLocation, type SearchRouteState } from "../src/client/search";
import type { SearchScope } from "../src/client/search-palette";
import { connectRemoteText } from "../src/client/remote-text";
import { isTvPresentation } from "../src/client/session/presentation";
import type { TextFocus } from "../src/shared/remote";
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const originalFetch = window.fetch;
  const requests: string[] = [];
  let plays = 0;
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
    requests.push(url.href);
    if (url.pathname === "/api/radio/avoid") return Response.json({ stations: [{ id: "old", name: "Old radio", url: "https://radio.example/stream" }] });
    return Response.json({ items: [], favorites: [], stations: [], playlists: [], programmes: {} });
  };
  let remote: ReturnType<typeof connectRemoteText> | undefined;
  const recentKey = "couch.search-recents:search-regression";
  const savedRecents = localStorage.getItem(recentKey);
  localStorage.setItem(recentKey, JSON.stringify(["Recent query"]));
  let setScope: (value: SearchScope | null) => void = () => {};
  const gate = { connected: true, run: async () => { plays++; return true; }, state: { devices: [], liveSources: [] }, credentials: { installationId: "search-regression", origin: location.origin, token: "fixture" } } as unknown as SessionGateValue;
  function Fixture() {
    const [searchScope, setSearchScope] = useState<SearchScope | null>(null);
    setScope = setSearchScope;
    const route = useLocation();
    // The shell's own: a scope on the results page replaces its URL, as AppShell's changeSearch does.
    const changeSearch = (state: SearchRouteState) => router.history.replace(searchLocation(state));
    return <SessionGateContext value={gate}><QueryClientProvider client={client}><ShellContext value={{ searchScope, setSearchScope, changeSearch, recentRadio: [] } as unknown as ShellValue}><HeaderSearch /><main data-page tabIndex={-1}>{route.pathname === "/search" && <SearchPanel origin={location.origin} token="fixture" connected canPlay active searchState={readSearchState(route.searchStr)} onSearchChange={changeSearch} onCommand={gate.run} />}</main></ShellContext></QueryClientProvider></SessionGateContext>;
  }
  const rootRoute = createRootRoute({ component: Fixture });
  const routeTree = rootRoute.addChildren(["/", "search", "radio", "saved"].map(path => createRoute({ getParentRoute: () => rootRoute, path })));
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/search?q=old"] }) });
  const field = () => host.querySelector<HTMLInputElement>("#media-search")!;
  const input = async (value: string) => {
    field().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
  };
  const navigate = async (href: string) => { await router.navigate({ href }); await wait(); };
  const press = async (key: string) => { const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }); field().dispatchEvent(event); await wait(); return event; };
  const tokens = () => [...host.querySelectorAll("[data-search-token]")].map(token => token.textContent).join();
  const selected = () => document.getElementById(field().getAttribute("aria-activedescendant") ?? "");
  const kind = () => new URLSearchParams(router.state.location.searchStr).get("kind");
  const query = () => new URLSearchParams(router.state.location.searchStr).get("q");
  try {
    root.render(<RouterProvider router={router} />);
    await wait(900);
    const initialRequests = requests.length;
    assert(initialRequests > 0, "Fixture did not exercise provider requests");
    const closest = host.querySelector<HTMLButtonElement>("[data-search-top] [data-page-first]")!;
    assert(closest?.textContent?.startsWith("Play") && !closest.disabled, "Fixture did not render a playable closest match");
    const searchButton = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    field().focus();
    searchButton.click();
    await wait();
    assert(plays === 0 && query() === "old", "Unchanged-query Search button played the closest match");
    searchButton.focus();
    // Keyboard activation submits with the button as submitter too.
    field().form!.requestSubmit(searchButton);
    await wait();
    assert(plays === 0 && query() === "old", "Unchanged-query button submission played the closest match");
    field().focus();
    // The TV's OK opens the palette first; its next OK does the query.
    if (isTvPresentation()) { await press("Enter"); assert(host.querySelector("[cmdk-list]"), "The TV's OK did not open the palette"); }
    const repeatEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    field().dispatchEvent(repeatEnter);
    if (!repeatEnter.defaultPrevented) field().form!.requestSubmit(searchButton);
    await wait();
    assert(plays === 1 && query() === "old", "Repeat Enter in the field did not play the closest match once");
    assert(requests.length === initialRequests, "Unchanged-query submission repeated provider requests");
    await input("draft before composition");
    const selection = field().getAttribute("aria-activedescendant");
    for (const modifier of ["shiftKey", "ctrlKey", "metaKey", "altKey"]) for (const key of ["ArrowUp", "ArrowDown"]) {
      const event = new KeyboardEvent("keydown", { key, [modifier]: true, bubbles: true, cancelable: true });
      field().dispatchEvent(event);
      await wait();
      assert(!event.defaultPrevented && document.activeElement === field() && field().getAttribute("aria-activedescendant") === selection, "Modified arrow was consumed by the palette");
    }
    await wait(650);
    assert(query() === "old", `Unsubmitted edit changed the route: ${router.state.location.href}`);
    assert(requests.length === initialRequests, "Unsubmitted edit started provider requests");
    assert(host.querySelector("form")?.getAttribute("aria-busy") === "false", "Draft was marked busy");
    field().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await input("日本");
    await wait(600);
    assert(query() === "old", "IME draft escaped during composition");
    field().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    const confirmation = new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true });
    field().dispatchEvent(confirmation);
    assert(confirmation.defaultPrevented && query() === "old", "IME confirmation Enter was allowed to submit after composition ended");
    await wait(650);
    assert(query() === "old" && field().value === "日本", "Completed IME text submitted without Search");
    host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await wait();
    assert(query() === "日本", "Search action did not submit the IME draft");
    await input("ordinary enter");
    const enter = new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true });
    field().dispatchEvent(enter);
    if (!enter.defaultPrevented) field().form!.requestSubmit(searchButton);
    await wait();
    assert(query() === "ordinary enter", "Ordinary Enter did not submit immediately");
    assert(!host.querySelector("[cmdk-list]"), "A submitted search left the palette open");
    if (!isTvPresentation()) {
      await press("Escape");
      assert(document.activeElement !== field() && field().value === "ordinary enter" && query() === "ordinary enter", "Escape after a search cleared it instead of leaving the field");
    }
    await input("");
    await wait(650);
    assert(query() === "ordinary enter", "Deleting the draft navigated before submission");
    const recent = [...host.querySelectorAll<HTMLElement>("[data-search-recents] [cmdk-item]")].find(item => item.textContent === "Recent query")!;
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
    await navigate("/radio");
    await input("old provider draft");
    setScope({ source: "Bandcamp" });
    await wait(650);
    assert(router.state.location.pathname === "/radio", "Pending draft searched under a newly selected provider");
    assert(host.querySelector("form")?.getAttribute("aria-busy") === "false", "Cancelled search left a permanent busy indicator");
    await navigate("/search?q=x");
    const page = host.querySelector<HTMLElement>("main")!;
    page.focus(); page.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true, cancelable: true }));
    await wait(650);
    assert(query() === "x" && field().value === "xy", "Type-to-search submitted its draft");
    field().form!.requestSubmit();
    await wait();
    assert(query() === "xy", "Type-to-search draft did not submit");
    await input("");
    assert(!selected(), "An empty palette selected a row before an arrow");
    await press("ArrowDown");
    assert(document.activeElement === field() && selected()?.textContent === "Films & series", "Down did not select the palette's first row, or took the focus from the field");
    await press("ArrowRight"); await press("ArrowRight");
    // The TV's columns: Right crosses to the recent searches. Elsewhere the kinds are a line, and Right moves along it.
    if (isTvPresentation()) assert(selected()?.closest("[data-search-recents]") && document.activeElement === field(), "Right did not cross the palette's columns to the recent searches");
    else assert(selected()?.textContent === "Live" && document.activeElement === field(), "Right did not move along the kinds");
    assert(![...host.querySelectorAll("[cmdk-group-heading]")].some(heading => heading.textContent === "Sources"), "The empty palette still lists the sources");
    await press("ArrowLeft"); await press("ArrowLeft");
    await press("Enter");
    assert(tokens() === "Films & series" && kind() === "films" && query() === "xy", `A scope on the results page did not reach the URL: ${router.state.location.href}`);
    await press("Backspace");
    assert(tokens() === "" && !kind(), "Backspace in an empty field did not remove the token from the field and the URL");
    await input("yt");
    assert(selected()?.textContent?.startsWith("Search"), "Typing did not select the query row");
    assert([...host.querySelectorAll("[cmdk-item]")].some(item => item.textContent === "YouTubeTab"), "The scope the text names was not suggested with Tab");
    const tab = await press("Tab");
    assert(tab.defaultPrevented && tokens() === "YouTube" && field().value === "" && new URLSearchParams(router.state.location.searchStr).get("source") === "YouTube", "Tab did not turn the text into its token");
    await input("old");
    await press("Backspace");
    assert(tokens() === "YouTube", "Backspace in a typed field removed a token");
    await input("");
    await press("Backspace");
    assert(tokens() === "", "Backspace did not remove the completed token");
    if (!isTvPresentation()) {
      await press("Escape");
      assert(!host.querySelector("[cmdk-list]") && document.activeElement !== field(), "Escape in an empty field did not close the palette and leave it");
    }
    await navigate("/radio");
    setScope({ source: "Bandcamp" });
    await wait();
    await input("  local music  ");
    await wait(650);
    assert(router.state.location.pathname === "/radio" && tokens() === "Bandcamp", "Scoped draft navigated early or lost its source");
    host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await wait();
    assert(query() === "local music" && new URLSearchParams(router.state.location.searchStr).get("source") === "Bandcamp", "Submission lost trimming or source scope");
    const historyLength = router.history.length;
    await input("next album");
    field().form!.requestSubmit();
    await wait();
    assert(query() === "next album" && router.history.length === historyLength, "Later search stopped replacing its history entry");
    await input("unsaved history draft");
    router.history.back();
    await wait();
    assert(router.state.location.pathname === "/radio" && field().value === "", "Back did not restore the originating page");
    router.history.forward();
    await wait();
    assert(query() === "next album" && field().value === "next album", "Forward did not restore the submitted query");
    await input("https://example.com/watch");
    field().form!.requestSubmit();
    await wait();
    assert(query() === "https://example.com/watch" && !new URLSearchParams(router.state.location.searchStr).has("source"), "Pasted link retained the source scope");
    // Enter on a pasted link plays it from the palette, and stays where it is.
    const linkPlays = plays;
    await input("https://example.com/other");
    assert(selected()?.textContent?.startsWith("Play"), "A pasted link did not select its Play");
    if (isTvPresentation() && !host.querySelector("[cmdk-list]")) await press("Enter");
    await press("Enter");
    assert(plays === linkPlays + 1 && query() === "https://example.com/watch", "Enter on a pasted link did not play it in place");
    assert(!host.querySelector("[cmdk-list]") && field().value === "" && document.activeElement !== field(), "A played link left the palette open or the field focused");
    await input("   ");
    field().form!.requestSubmit();
    await wait();
    assert(router.state.location.pathname === "/", "Empty submission did not open Home");
    await navigate("/search?q=clear");
    host.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();
    await wait();
    assert(router.state.location.pathname === "/" && document.activeElement === field(), "Clear lost Home or field focus");
    if (isTvPresentation()) {
      let focus: TextFocus | null = null;
      remote = connectRemoteText(next => { focus = next; });
      assert(focus, "Remote did not find the focused search field");
      const send = (text: string, submit = false) => remote!.receive({ type: "text", requestId: "fixture", token: focus!.token, text, submit });
      assert(await send("remote draft"), "Remote Send was rejected");
      await wait(650);
      assert(router.state.location.pathname === "/" && field().value === "remote draft", "Remote Send submitted its draft");
      assert(await send("remote search", true), "Remote Enter was rejected");
      await wait();
      assert(query() === "remote search", "Remote Enter did not submit");
      assert(await send(""), "Remote Clear was rejected");
      await wait(650);
      assert(query() === "remote search" && field().value === "", "Remote Clear navigated before submission");
      assert(await send("", true), "Remote empty Enter was rejected");
      await wait();
      assert(router.state.location.pathname === "/", "Remote empty Enter did not open Home");
      assert(await send("old", true), "Remote search was rejected");
      await wait(650);
      const beforeRepeat = plays;
      assert(await send("old", true), "Remote repeat Enter was rejected");
      await wait();
      assert(plays === beforeRepeat + 1, "Remote repeat Enter did not play the closest match once");
    }
    return { passed: true, remote: isTvPresentation(), checks: ["palette arrows, kinds and scope tokens", "Tab completion and Backspace", "pasted link plays", "unchanged-query button never plays", "repeat Enter plays once", "drafts cause no routes or requests", "Search submits IME completion", "IME confirmation Enter suppressed", "ordinary Enter submits", "recents never submit", "section navigation cancels", "query navigation cancels", "scope changes cancel", "busy indicator settles", "type-to-search stays local", "scoped submission", "back and forward", "pasted links", "empty submission and Clear", "recents keyboard focus"] };
  } finally {
    remote?.close(); root.unmount(); client.clear(); window.fetch = originalFetch;
    if (savedRecents === null) localStorage.removeItem(recentKey); else localStorage.setItem(recentKey, savedRecents);
  }
}
