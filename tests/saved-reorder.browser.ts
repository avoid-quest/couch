import { mountUiAudit } from "./ui-audit.browser";

const wait = () => new Promise(resolve => setTimeout(resolve, 150));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

/** Reordering stays within its store and disables only the first/last moves. */
export async function runSavedReorderRegression() {
  const audit = await mountUiAudit();
  const fixtureFetch = window.fetch;
  let later = ["first", "middle", "last"].map(id => ({ id, title: id, kind: "web", url: `https://www.youtube.com/watch?v=${id}` }));
  let online = ["channel-a", "channel-b"].map(id => ({ id, title: id, provider: "youtube", kind: "channel", url: `https://www.youtube.com/@${id}` }));
  let radio = ["radio-a", "radio-b"].map(id => ({ id, name: id, url: `https://example.com/${id}` }));
  const writes: { path: string; order: string[] }[] = [];
  window.fetch = async (input, init) => {
    const path = new URL(String(input), location.href).pathname;
    if (path.endsWith("/reorder")) {
      const { order } = JSON.parse(String(init?.body)) as { order: string[] };
      writes.push({ path, order });
      const reordered = <T extends { id: string }>(items: T[]) => order.map(id => items.find(item => item.id === id)!);
      if (path === "/api/for-later/reorder") later = reordered(later);
      if (path === "/api/providers/favorites/reorder") online = reordered(online);
      if (path === "/api/radio/favorites/reorder") radio = reordered(radio);
      return Response.json({});
    }
    if (path === "/api/for-later") return Response.json({ items: later });
    if (path === "/api/providers/favorites") return Response.json({ favorites: online });
    if (path === "/api/radio/favorites") return Response.json({ favorites: radio });
    return fixtureFetch(input, init);
  };
  const open = async (title: string) => {
    const trigger = document.querySelector<HTMLElement>(`button[aria-label="Options for ${title}"]`);
    assert(trigger, `Missing menu for ${title}`);
    trigger!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", ctrlKey: false }));
    await wait();
    const action = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === label)!;
    return { up: action("Move up"), down: action("Move down") };
  };
  const close = async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(); };
  const disabled = (element: HTMLElement) => element.getAttribute("aria-disabled") === "true";
  try {
    await audit.go("/saved?tab=later", { fresh: true });
    let menu = await open("first");
    assert(disabled(menu.up) && !disabled(menu.down), "First saved item has wrong move boundaries");
    await close(); menu = await open("last");
    assert(!disabled(menu.up) && disabled(menu.down), "Last saved item has wrong move boundaries");
    await close(); menu = await open("middle");
    assert(!disabled(menu.up) && !disabled(menu.down), "Middle saved item cannot move in both directions");
    menu.up.click(); await wait();
    assert(writes.length === 1 && writes[0]!.order.join() === "middle,first,last", "Saved move did not persist the swapped order");
    await audit.go("/saved?tab=channels");
    for (const [title, up, down] of [["channel-a", true, false], ["channel-b", false, true], ["radio-a", true, false], ["radio-b", false, true]] as const) {
      menu = await open(title);
      assert(disabled(menu.up) === up && disabled(menu.down) === down, `${title} can move beyond its own store`);
      await close();
    }
    menu = await open("radio-a"); menu.down.click(); await wait();
    assert(writes.length === 2 && writes[1]!.path === "/api/radio/favorites/reorder" && writes[1]!.order.join() === "radio-b,radio-a", "Station reorder included provider favorites");
    return { passed: true, checks: ["saved item boundaries", "persisted move", "provider/station boundaries", "station-only reorder"] };
  } finally { window.fetch = fixtureFetch; audit.close(); }
}

/** Menu availability must not scan/copy the entire saved list for every row. */
export async function runSavedRenderingRegression() {
  const audit = await mountUiAudit();
  const count = 100;
  let reads = 0;
  const items = Array.from({ length: count }, (_, index) => new Proxy({ id: `item-${index}`, title: `Item ${index}`, kind: "web", url: `https://www.youtube.com/watch?v=item-${index}` }, {
    get(item, property, receiver) { if (property === "id") reads++; return Reflect.get(item, property, receiver); },
  }));
  try {
    await audit.go("/saved?tab=later");
    audit.client.setQueryDefaults(["for-later"], { structuralSharing: false });
    audit.client.setQueryData(["for-later"], { items });
    await wait();
    assert(document.querySelectorAll("[data-saved-details]").length === count, "Saved render probe did not display its full list");
    assert(reads < count * 30, `Rendering ${count} saved items scanned IDs ${reads} times`);
    const savedReads = reads;
    await audit.go("/saved?tab=channels");
    const favorites = Array.from({ length: count }, (_, index) => new Proxy({ id: `channel-${index}`, title: `Channel ${index}`, provider: "youtube", kind: "channel", url: `https://www.youtube.com/@channel-${index}` }, {
      get(item, property, receiver) { if (property === "id") reads++; return Reflect.get(item, property, receiver); },
    }));
    audit.client.setQueryDefaults(["providers", "favorites"], { structuralSharing: false });
    reads = 0;
    audit.client.setQueryData(["providers", "favorites"], { favorites });
    await wait();
    assert(document.querySelectorAll('[aria-label="Channels & stations"] [data-row-options]').length >= count, "Favorites render probe did not display its full list");
    assert(reads < count * 30, `Rendering ${count} favorites scanned IDs ${reads} times`);
    return { passed: true, count, savedReads, favoriteReads: reads };
  } finally { audit.close(); }
}
