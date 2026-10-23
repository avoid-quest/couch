// Run runCollectionRenderingRegression() on an empty Vite fixture, with ?tv=0 and ?tv=1.
// The production shell and collection route consume equivalent JSON-style session snapshots.
import { mountUiAudit } from "./ui-audit.browser";
import type { ProviderPage } from "../src/shared/providers";
import type { Action } from "../src/shared/protocol";
import { dismissAll } from "../src/client/toasts";

const wait = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const url = "https://www.youtube.com/playlist?list=PL1B627337ED6F55F0";
const href = `/collection?provider=youtube&url=${encodeURIComponent(url)}`;
const row = (index: number) => document.querySelector<HTMLElement>(`[data-hit-id="youtube:render-${index}:0"]`);
const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[data-page="Collection"] button')].find(item => item.textContent === label);
  if (!found) throw new Error(`Missing collection action: ${label}`);
  return found;
};

export async function runCollectionRenderingRegression() {
  const audit = await mountUiAudit();
  const key = ["search", "provider-page", "youtube", { url }];
  let offscreenReads = 0;
  try {
    await audit.go(href);
    const page = audit.client.getQueryData<ProviderPage>(key)!;
    const items = Array.from({ length: 1000 }, (_, index) => ({ ...page.items[0]!, id: `render-${index}`, title: `Concert ${index}`, url: `${page.items[0]!.url}&render=${index}` }));
    // Only full hit derivation reads offscreen artwork; the page renders 24 items.
    items[999] = new Proxy(items[999]!, { get(item, property, receiver) { if (property === "thumbnail") offscreenReads++; return Reflect.get(item, property, receiver); } });
    audit.client.setQueryDefaults(key, { structuralSharing: false });
    audit.client.setQueryData(key, { ...page, items });
    await wait();
    assert(offscreenReads > 0, "Probe did not reach full collection summary derivation");
    assert(document.querySelectorAll('[data-page="Collection"] [data-hit-id]').length === 24, "Fixture must retain the 24-item page");
    offscreenReads = 0;
    for (let i = 0; i < 3; i++) await audit.updateSession(current => ({ ...current, state: JSON.parse(JSON.stringify(current.state)) }));
    assert(offscreenReads === 0, `Equivalent session snapshots rebuilt the full collection summary (${offscreenReads} offscreen reads)`);

    audit.client.setQueryData(key, { ...page, items: items.map((item, index) => index === 0 ? { ...item, title: "Updated concert" } : item) });
    await wait();
    assert(offscreenReads > 0 && row(0)?.textContent?.includes("Updated concert"), "Changed provider data did not rebuild visible hits");
    offscreenReads = 0;
    audit.client.setQueryData(["hidden"], { rules: [{ id: "hidden", kind: "item", value: `youtube:${items[0]!.url}`, label: "Concert 0", createdAt: 1 }] });
    await wait();
    assert(offscreenReads > 0 && !row(0) && row(24), "Hidden rules did not update the full list and refill the page");

    await audit.updateSession(current => ({ ...current, state: { ...current.state!, player: { ...current.state!.player, status: "unavailable" } } }));
    assert(button("Play all").disabled && !button("Queue all").disabled, "Player permission change did not disable Play while retaining Queue");
    await audit.updateSession(current => ({ ...current, connected: false }));
    assert(button("Play all").disabled && button("Queue all").disabled, "Disconnect did not disable collection actions");
    const commands: Action[] = [];
    await audit.updateSession(current => ({ ...current, connected: true, run: async action => { commands.push(action); return true; }, videoQualityPreference: { ...current.videoQualityPreference, quality: "720p" }, state: { ...current.state!, player: { ...current.state!.player, status: "idle" } } }));
    button("Queue all").click(); await wait();
    const queued = commands.at(-1);
    assert(queued?.type === "enqueueProvider" && queued.url === url && queued.quality === "720p" && !queued.playNow, "Collection action retained an old command handler or quality");

    const opener = row(1)?.querySelector<HTMLElement>("a")!;
    assert(opener, "Missing first visible item link");
    opener.focus(); opener.click(); await wait();
    assert(audit.router.state.location.search.url === items[1]!.url, "Stable Open callback did not navigate to its current item");
    audit.router.history.back(); await wait();
    assert(audit.router.state.location.search.url === url && row(1)?.contains(document.activeElement), "Stable navigation lost the current opener on Back");
    return { passed: true, checks: ["equivalent snapshots skip full collection derivation", "provider data and hidden rules update", "player availability and disconnect update actions", "fresh command handler and quality", "Open and Back preserve current item and focus"] };
  } finally { audit.close(); }
}

export async function runCollectionHistoryFreshnessRegression() {
  const audit = await mountUiAudit();
  const fixtureFetch = window.fetch;
  const writes: { origin: string; token: string | null; path: string; body: Record<string, unknown> }[] = [];
  window.fetch = async (input, init) => {
    const target = new URL(String(input), location.href);
    if (target.pathname.endsWith("/play")) writes.push({ origin: target.origin, token: new Headers(init?.headers).get("Authorization"), path: target.pathname + target.search, body: JSON.parse(String(init?.body ?? "{}")) });
    return fixtureFetch(input, init);
  };
  try {
    const mediaUrl = "https://www.youtube.com/watch?v=vWLJeqLPfSU";
    await audit.go(`/collection?provider=youtube&url=${encodeURIComponent(mediaUrl)}`);
    const resume = () => button([...document.querySelectorAll('[data-page="Collection"] button')].find(item => item.textContent?.startsWith("Resume"))?.textContent ?? "Resume");
    assert(!resume().disabled, "Fixture needs a resumable history item");
    await audit.updateSession(current => ({ ...current, state: { ...current.state!, activeProfile: { id: "new-profile", name: "New profile" } } }));
    resume().click(); await wait();
    assert(writes.at(-1)?.body.profileId === "new-profile" && writes.at(-1)?.body.fromStart === false, "Resume retained the previous profile");
    await audit.updateSession(current => ({ ...current, credentials: { ...current.credentials!, origin: "http://next-fixture.invalid", token: "next-fixture-token" } }));
    resume().click(); await wait();
    assert(writes.at(-1)?.origin === "http://next-fixture.invalid" && writes.at(-1)?.token === "Bearer next-fixture-token" && writes.at(-1)?.body.profileId === "new-profile", "Resume retained old credentials or profile");
    button("From start").click(); await wait();
    assert(writes.at(-1)?.body.fromStart === true, "From start lost its action options");
    dismissAll();
    await audit.updateSession(current => ({ ...current, state: { ...current.state!, controlling: "audit-tv", devices: current.state!.devices!.map(device => device.id === "audit-tv" ? { ...device, name: "Bedroom" } : device) } }));
    resume().click(); await wait();
    assert(document.querySelector('[data-sonner-toaster]')?.textContent?.includes("Playing on Bedroom"), "Resume retained the old controlled device or device name");
    await audit.updateSession(current => ({ ...current, state: { ...current.state!, devices: current.state!.devices!.map(device => device.id === "audit-tv" ? { ...device, name: "Renamed bedroom" } : device) } }));
    resume().click(); await wait();
    assert(document.querySelector('[data-sonner-toaster]')?.textContent?.includes("Playing on Renamed bedroom"), "Resume retained a renamed destination");
    const count = writes.length;
    await audit.updateSession(current => ({ ...current, connected: false }));
    assert(resume().disabled, "Disconnected Resume remained enabled");
    resume().click(); await wait();
    assert(writes.length === count, "Disconnected Resume sent a request");
    return { passed: true, checks: ["latest profile", "latest credentials", "From start options", "latest controlled device and name", "disconnect prevents history action"] };
  } finally { window.fetch = fixtureFetch; audit.close(); dismissAll(); }
}
