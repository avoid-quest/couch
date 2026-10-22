// Run on an empty Vite fixture at ?tv=0 and ?tv=1. Real routes, headers,
// query cache and AppShell actions; only API reads/commands are fixtures.
import { mountUiAudit } from "./ui-audit.browser";
import { collectionLocation } from "../src/client/detail-navigation";
import { applyTvNavigation } from "../src/client/navigation";
import { isTvPresentation } from "../src/client/session/presentation";
import type { ProviderItem, ProviderPage } from "../src/shared/providers";
import type { MediaCollection } from "../src/shared/media";
import type { Action } from "../src/shared/protocol";

const wait = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const video = "https://www.youtube.com/watch?v=vWLJeqLPfSU";
const list = { title: "Tiny Desk concerts", url: "https://www.youtube.com/playlist?list=PL1B627337ED6F55F0", index: 0 };
const item: ProviderItem = { id: "concert", provider: "youtube", kind: "media", title: "Fixture video", url: video };
const key = (url: string, cursor?: string) => ["search", "provider-page", "youtube", { url, ...(cursor ? { cursor } : {}) }];
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-page="Collection"] [data-hit-id]')];
const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[data-page="Collection"] button')].find(node => node.textContent === label || node.getAttribute("aria-label") === label);
  if (!found) throw new Error(`Missing action: ${label}`);
  return found;
};

export async function runYouTubeNeighboursRegression() {
  const results: { name: string; nearby: string[] }[] = [];
  for (const scenario of [
    { name: "unique final video", indices: [0, 1, 2, 3, 4], duplicate: false },
    { name: "duplicate final video", indices: [0, 1, 2, 3, 4], duplicate: true },
    { name: "unavailable hole", indices: [0, 2, 3, 4, 5], duplicate: true },
    { name: "later cursor and unavailable hole", indices: [24, 26, 27, 28, 29], duplicate: true },
  ]) {
    const audit = await mountUiAudit();
    try {
      const items = scenario.indices.map((index, offset) => {
        const identity = offset === 4 && scenario.duplicate ? 0 : offset;
        return { ...item, id: `occurrence-${identity}`, title: `Occurrence ${identity}`,
          url: identity ? `https://www.youtube.com/watch?v=fixture000${identity}` : video, collection: { ...list, index } };
      });
      const page: ProviderPage = { item: { ...item, kind: "collection", title: list.title, url: list.url }, title: list.title, items };
      audit.client.setQueryData(key(list.url), page);
      if (scenario.indices[0] === 24) audit.client.setQueryData(key(list.url, "24"), page);
      await audit.go(collectionLocation({ provider: "youtube", url: list.url }));
      const opener = rows().at(-1)!.querySelector<HTMLElement>("a")!;
      opener.focus();
      if (isTvPresentation()) applyTvNavigation("select"); else opener.click();
      await wait(400);
      assert(audit.router.state.location.search.context?.index === scenario.indices.at(-1), `${scenario.name}: Open lost raw occurrence`);
      const section = document.querySelector(`section[aria-label="More from ${list.title}"]`)!;
      const nearby = [...section.querySelectorAll('[data-hit-id]')].map(node => node.textContent ?? "");
      assert(nearby.length === 2 && nearby[0]?.startsWith("Occurrence 2") && nearby[1]?.startsWith("Occurrence 3"), `${scenario.name}: wrong neighbours ${JSON.stringify(nearby)}`);
      if (isTvPresentation()) {
        section.querySelector<HTMLElement>("h2 a")!.focus();
        applyTvNavigation("down"); await wait();
        assert(section.querySelector('[data-hit-id]')?.contains(document.activeElement), "TV Down missed the first nearby row");
        applyTvNavigation("back");
      } else audit.router.history.back();
      await wait();
      assert(rows().at(-1)?.contains(document.activeElement), `${scenario.name}: Back lost the exact repeated opener`);
      assert(document.documentElement.scrollWidth <= innerWidth, `${scenario.name}: horizontal overflow`);
      results.push({ name: scenario.name, nearby });
    } finally { audit.close(); }
  }
  // Old metadata may not know an occurrence: retain the URL-based neighbourhood.
  const audit = await mountUiAudit();
  try {
    const items = Array.from({ length: 5 }, (_, index) => ({ ...item, id: `fallback-${index}`, title: `Fallback ${index}`,
      url: index ? `https://www.youtube.com/watch?v=fixture000${index}` : video, collection: { ...list, index } }));
    audit.client.setQueryData(key(list.url), { items });
    audit.client.setQueryData(key(video), { item, items: [item] });
    await audit.go(collectionLocation({ ...item, collection: { title: list.title, url: list.url } }));
    const nearby = [...document.querySelectorAll(`section[aria-label="More from ${list.title}"] [data-hit-id]`)].map(node => node.textContent ?? "");
    assert(nearby.length === 4 && nearby[0]?.startsWith("Fallback 1"), "Unknown occurrence lost its URL fallback");
    results.push({ name: "unknown occurrence fallback", nearby });
  } finally { audit.close(); }
  return { passed: true, results };
}

export async function runYouTubeDetailActionsRegression() {
  const results: { name: string; commands: Action[]; writes: unknown[] }[] = [];
  const selectedList = { ...list, title: "Selected list", url: "https://www.youtube.com/playlist?list=PLselected123", index: 2 };
  const cases: { name: string; url?: string; selected?: MediaCollection; history?: boolean; changed?: boolean }[] = [
    ...[video, "https://youtu.be/vWLJeqLPfSU", "https://www.youtube.com/shorts/vWLJeqLPfSU", `${video}&t=12`].map(url => ({ name: `canonical Queue: ${url}`, url })),
    { name: "selected other playlist", selected: selectedList, history: true, changed: true },
    { name: "selected later duplicate", selected: { ...list, index: 2 }, history: true, changed: true },
    { name: "same occurrence", selected: list, history: true },
    { name: "history without selected context", history: true },
    { name: "fresh selected Play", selected: selectedList },
  ];
  for (const scenario of cases) {
    const audit = await mountUiAudit(), commands: Action[] = [], writes: { path: string; body: { fromStart?: boolean; profileId?: string } }[] = [];
    const fixtureFetch = window.fetch;
    window.fetch = async (input, init) => {
      const target = new URL(String(input), location.href);
      if (target.pathname.endsWith("/play")) writes.push({ path: target.pathname + target.search, body: JSON.parse(String(init?.body ?? "{}")) });
      return fixtureFetch(input, init);
    };
    try {
      const url = scenario.url ?? video;
      audit.client.setQueryData(key(url), { item, title: item.title, items: [item] });
      audit.client.setQueryData(["progress", "history", "youtube"], { items: scenario.history ? [{ ...item, mediaId: "audit-history", position: 120, duration: 900, watched: false, playable: true, collection: list }] : [] });
      await audit.go(collectionLocation({ ...item, url, collection: scenario.selected }));
      await audit.updateSession(current => ({ ...current, run: async action => { commands.push(action); return true; }, videoQualityPreference: { ...current.videoQualityPreference, quality: "720p" } }));
      button(scenario.history ? "Resume" : "Play").click(); await wait();
      if (scenario.changed || !scenario.history) {
        const play = commands.at(-1);
        assert(play?.type === "enqueueProvider" && play.url === video && play.playNow && play.quality === "720p", `${scenario.name}: Play retained old identity, handler or quality`);
        assert(JSON.stringify(play.collection) === JSON.stringify(scenario.selected), `${scenario.name}: selected occurrence missed the command boundary`);
        assert(writes.length === 0, `${scenario.name}: used the historical media-ID endpoint`);
      } else assert(writes.at(-1)?.path.includes("audit-history/play") && writes.at(-1)?.body.fromStart === false, `${scenario.name}: history Resume changed`);
      button("Queue").click(); await wait();
      const queued = commands.at(-1);
      assert(queued?.type === "enqueueProvider" && queued.url === video && !queued.playNow && queued.quality === "720p", `${scenario.name}: Queue lost canonical identity or fresh quality`);
      if (scenario.history) {
        button("From start").click(); await wait();
        if (scenario.changed) {
          const restarted = commands.at(-1);
          assert(restarted?.type === "enqueueProvider" && restarted.fromStart === true && restarted.collection?.index === scenario.selected?.index && restarted.collection?.url === scenario.selected?.url, `${scenario.name}: From start lost selected context or restart intent`);
          const trigger = button(`Play ${item.title} on`);
          trigger.focus();
          if (isTvPresentation()) applyTvNavigation("select"); else trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
          await wait(80);
          const destination = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === "Living room TV");
          assert(destination, `Missing Play on destination: ${[...document.querySelectorAll('[role="menuitem"]')].map(node => node.textContent)}`);
          destination!.click(); await wait();
          const remote = commands.at(-1);
          assert(remote?.type === "enqueueProvider" && remote.deviceId === "audit-tv" && remote.quality === "720p" && !remote.fromStart && remote.collection?.index === scenario.selected?.index, `${scenario.name}: Play on lost resume, destination, quality or occurrence`);
        } else assert(writes.at(-1)?.body.fromStart === true, `${scenario.name}: history From start changed`);
      }
      const count = commands.length + writes.length;
      await audit.updateSession(current => ({ ...current, connected: false }));
      assert(button(scenario.history ? "Resume" : "Play").disabled && button("Queue").disabled, "Disconnected detail actions remained enabled");
      button("Queue").click(); await wait(50);
      assert(commands.length + writes.length === count, "Disconnected detail sent an action");
      results.push({ name: scenario.name, commands, writes });
    } finally { window.fetch = fixtureFetch; audit.close(); }
  }
  return { passed: true, results };
}
