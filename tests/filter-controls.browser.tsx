// Run on an empty Vite page with #fixture. Real routes and controls; no external writes.
import { mountUiAudit } from "./ui-audit.browser";
import { readSearchState } from "../src/client/search";

const wait = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const field = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = (label: string, value: string) => {
  const input = field(label);
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function pick(label: string, text: string) {
  const choice = [...document.querySelectorAll<HTMLElement>(`[role="radiogroup"][aria-label="${label}"] [role="radio"]`)].find(choice => choice.textContent === text);
  assert(choice, `Missing ${label} choice: ${text}`);
  choice!.focus(); choice!.click();
  await wait();
  assert(choice!.getAttribute("aria-checked") === "true" && document.activeElement === choice, `${label} did not keep its choice focused`);
}
async function choose(label: string, text: string) {
  const trigger = button(label);
  trigger.focus();
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(50);
  const selected = document.querySelector<HTMLElement>('[role="option"][data-state="checked"]');
  if (selected?.firstElementChild?.firstElementChild) assert(selected.lastElementChild!.getBoundingClientRect().right <= selected.firstElementChild.getBoundingClientRect().left, "Selected filter text overlaps its checkmark");
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.startsWith(text));
  assert(option, `Missing ${label} option: ${text}`);
  option!.click();
  await wait();
  assert(document.activeElement === trigger, `${label} did not return focus to its trigger`);
}

export async function runFilterControlsRegression() {
  const audit = await mountUiAudit();
  const fixtureFetch = window.fetch;
  const guideReads: string[] = [];
  let releaseGuide: (() => void) | undefined;
  let holdGuide = false;
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href);
    if (url.pathname === "/api/iptv/guide") {
      const q = url.searchParams.get("q") ?? "";
      guideReads.push(q);
      if (holdGuide) await new Promise<void>(resolve => { releaseGuide = resolve; });
      const channel = { id: "arts", name: "Arts live", group: "Culture", url: "https://example.com/live.m3u8" };
      const channels = channel.name.toLowerCase().includes(q.toLowerCase()) ? [channel] : [];
      return Response.json({ channels, total: channels.length, groups: ["Culture", "News"] });
    }
    return fixtureFetch(input, init);
  };
  const searched = () => readSearchState(audit.router.state.location.searchStr);
  try {
    await audit.go('/search?q=missing&kind=music&source=Bandcamp', { mode: "empty", fresh: true });
    assert(button("Source") && document.querySelector('[role="radiogroup"][aria-label="Kind"]'), "Empty search hid its filters");
    assert(!button("Ends by") && !document.body.textContent?.includes("Clear filters"), "Search kept a removed filter");
    assert(document.body.textContent?.includes("No music on Bandcamp for “missing”"), "Empty filtered search does not say what it looked for");
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "All results")!.click(); await wait();
    assert(!searched().kind && searched().source === "All", "All results kept a kind or a source");
    await audit.go('/search?q=concert', { mode: "loaded", fresh: true });
    const searchReads = audit.calls.length;
    await choose("Source", "StreamingCommunity");
    assert(searched().source === "StreamingCommunity", "Source selection did not reach the URL");
    await pick("Kind", "Music");
    assert(searched().kind === "music" && searched().source === "All", "A source without hits of the chosen kind stayed chosen");
    await choose("Source", "Bandcamp");
    await pick("Kind", "All");
    assert(searched().source === "Bandcamp", "A source with hits of the chosen kind was dropped");
    await choose("Source", "All sources");
    assert(audit.calls.length === searchReads, "Filtering unnecessarily refetched cached results");

    await audit.go('/discover/radio');
    assert(!button("Clear filter"), "An empty filter offered to clear itself");
    const radioReads = audit.calls.length;
    type("Filter stations", "  NTS  "); await wait();
    assert(document.querySelector('[aria-label="Radio stations"]'), "Whitespace prevented a matching station");
    assert(document.activeElement === field("Filter stations"), "Station filtering stole focus");
    assert(audit.calls.length === radioReads, "Local station filtering sent a request");
    assert(!document.querySelector('[aria-label="Browse pages"]'), "A single page of stations showed a pager");
    await pick("Source", "Radio directory");
    assert(field("Filter stations").value === "  NTS  ", "Switching source discarded the station filter");
    type("Filter stations", "no match"); await wait();
    assert(document.body.textContent?.includes("No stations match"), "Radio empty filter has no explanation");
    button("Clear filter").click(); await wait();
    assert(field("Filter stations").value === "" && document.activeElement === field("Filter stations") && !button("Clear filter"), "Clear station filter lost focus or value, or kept its button");

    const collection = '/collection?provider=youtube&url=' + encodeURIComponent('https://www.youtube.com/playlist?list=PL1B627337ED6F55F0');
    const context = { title: "NPR Music", url: "https://www.youtube.com/@nprmusic" };
    await audit.go(collection + '&context=' + encodeURIComponent(JSON.stringify(context)) + '&from=saved');
    const collectionReads = audit.calls.length;
    type("Filter items", "Anderson"); await wait();
    assert(document.querySelectorAll('[data-hit-id]').length === 1, "Collection filter did not narrow the list");
    assert(document.activeElement === field("Filter items"), "Collection filtering stole focus");
    assert(audit.calls.length === collectionReads, "Local collection filtering sent a request");
    assert(audit.router.state.location.search.from === "saved" && JSON.stringify(audit.router.state.location.search.context) === JSON.stringify(context), "Filtering discarded the collection context or originating section");
    const filteredLocation = audit.router.state.location.href;
    await audit.go('/item?kind=saved&id=concert');
    audit.router.history.back(); await wait(400);
    assert(audit.router.state.location.href === filteredLocation && field("Filter items").value === "Anderson", "Back lost the collection filter");

    await audit.go(collection + '&cursors=' + encodeURIComponent(JSON.stringify(["next-page"])));
    assert(field("Filter this page"), "Remote collection does not disclose its filter scope");
    type("Filter this page", "no match"); await wait();
    assert(document.activeElement === field("Filter this page"), "Filtering a directly opened collection stole focus");
    assert(JSON.stringify(audit.router.state.location.search.cursors) === '["next-page"]', "Filtering lost the provider cursor");
    assert(document.querySelector('a[aria-label="Previous page"]'), "No matches hid the route to other pages");

    await audit.go('/discover/live-tv');
    holdGuide = true;
    type("Filter channels", "A"); await wait(20);
    type("Filter channels", "Ar"); await wait(20);
    type("Filter channels", "Arts"); await wait(300);
    assert(guideReads.join(',') === ',Arts', `Typing was not debounced: ${guideReads}`);
    assert(document.querySelector('[aria-label="Live TV channels"][aria-busy="true"]'), "Pending filter discarded the previous channels or hid its pending state");
    assert(document.activeElement === field("Filter channels"), "Pending filter stole focus");
    holdGuide = false; releaseGuide?.(); await wait();
    assert(document.querySelector('[aria-label="Live TV channels"][aria-busy="false"]'), "Completed filter remained busy");
    await choose("Group", "Culture");
    assert(field("Filter channels").value === "Arts", "Group selection discarded the name filter");
    type("Filter channels", "no match"); await wait(500);
    assert(document.body.textContent?.includes("No channels match"), "Empty guide filter has no recovery");
    button("Clear filter").click(); await wait(500);
    assert(field("Filter channels").value === "" && button("Group").textContent?.includes("Culture"), "Clearing text changed the selected group");
    assert(document.activeElement === field("Filter channels"), "Clearing text lost focus");
    return { passed: true, checks: ["empty search keeps all filters", "source selection preserves focus and cache", "radio source preserves text", "clear restores input focus", "local filtering makes no reads", "Back restores collection filters", "Live TV debounces typing", "pending requests retain channels", "group and text filters compose"] };
  } finally {
    releaseGuide?.();
    window.fetch = fixtureFetch;
    audit.close();
  }
}
