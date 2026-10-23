// Import on the Vite fixture page (?tv=0 or ?tv=1); exercises the production route tree and the Remote's Info path.
// Calm Now playing, Info in place, its keys and Back, Up next over it, and its scope to what plays.
import { mountUiAudit } from "./ui-audit.browser";
import { radioProgrammesQuery } from "../src/client/api/radio";
import { dispatchTvRoute } from "../src/client/session/session-context";
import { isTvPresentation } from "../src/client/session/presentation";

const wait = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const shown = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].some(element => element.checkVisibility());
const visibleText = () => document.querySelector<HTMLElement>("[data-player-audio-copy]")?.innerText ?? "";
const toggle = () => document.querySelector<HTMLButtonElement>('[data-player-top] button[aria-label="Info"]');
const expanded = () => toggle()?.getAttribute("aria-expanded") === "true";
const key = async (key: string, target: Element = document.activeElement ?? document.body) => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true }));
  await wait();
};
const focusIsUsable = () => document.activeElement !== document.body && !!document.activeElement?.isConnected && (document.activeElement as HTMLElement).checkVisibility();

export async function runPlayerInfoRegression() {
  const audit = await mountUiAudit();
  const tv = isTvPresentation();
  const checks: string[] = [];
  const check = async (name: string, run: () => Promise<void>) => { await run(); checks.push(name); };
  const programmes = radioProgrammesQuery({ origin: location.origin, token: "visual-fixture" }).queryKey;
  try {
    await check("radio opens calm", async () => {
      await audit.go("/now", { player: "playing", live: true, fresh: true });
      assert(document.querySelector("h1")?.textContent === "Early Bird", "Calm lost the show's title");
      assert(visibleText().includes("NTS Radio"), "Calm lost the station");
      for (const hidden of ["Community", "Experimental", "Alex", "min left", "Afternoon selections", "Music for the beginning"]) assert(!visibleText().includes(hidden), `Calm shows ${hidden}`);
      assert(!shown("[data-player-queue]"), "Up next is parked on screen in calm");
      const button = toggle();
      assert(button && !expanded() && document.getElementById(button.getAttribute("aria-controls")!)?.hidden, "Info's button does not control a hidden region");
      assert(navigator.mediaSession.metadata?.title === "Early Bird", "Media Session lost the show while calm");
      assert(document.documentElement.scrollWidth <= innerWidth, "Calm player overflows");
      if (innerHeight < 500) {
        const art = document.querySelector('[data-player-art]')!.getBoundingClientRect();
        assert(art.height >= 96 && art.width >= 96, "Short player collapsed the artwork");
        const title = document.querySelector('h1')!;
        assert(parseFloat(getComputedStyle(title).fontSize) > 18, "Short player reduced the title to body size");
      }
    });
    await check("Info button shows everything in place, without a transport action", async () => {
      const before = audit.actions.length;
      toggle()!.click(); await wait();
      assert(expanded() && audit.router.state.location.pathname === "/now", "Info left the player");
      for (const text of ["Community, Talk", "Jazz, Experimental, Alex", "min left", "Music for the beginning of the day.", "Afternoon selections"]) assert(visibleText().includes(text), `Info lacks ${text}`);
      assert(shown('[aria-label="Next programme"]'), "Info lacks the next programme");
      assert(audit.actions.length === before, "Info sent a playback command");
      const copy = document.querySelector<HTMLElement>("[data-player-audio-copy]")!;
      assert(copy.getBoundingClientRect().bottom <= document.querySelector("[data-player-band]")!.getBoundingClientRect().top, "Info runs under the band");
      toggle()!.click(); await wait();
      assert(!expanded() && !visibleText().includes("Experimental"), "Info's button did not return to calm");
    });
    if (!tv) await check("I toggles Info from the picture and from a focused control", async () => {
      const surface = document.querySelector<HTMLElement>("[data-player-surface]")!;
      surface.focus(); await key("i", surface);
      assert(expanded(), "I did not show Info");
      const link = [...document.querySelectorAll<HTMLAnchorElement>("[data-player-audio-copy] [data-media-context] a")].find(element => element.textContent === "NTS Radio")!;
      link.focus(); await key("i", link);
      assert(!expanded() && document.activeElement === link, "I on the station link lost its focus");
    });
    await check("Back closes Up next, then Info, before leaving", async () => {
      toggle()!.click(); await wait();
      const upNext = document.querySelector<HTMLButtonElement>('[data-player-tools] button[aria-label="Up next"]')!;
      upNext.focus(); upNext.click(); await wait();
      assert(shown("[data-player-queue]") && expanded(), "Up next did not open over Info");
      await key("Escape");
      assert(!document.querySelector("[data-player-queue]") && expanded() && focusIsUsable(), "Back did not close only Up next");
      await key("Escape");
      assert(!expanded() && audit.router.state.location.pathname === "/now" && focusIsUsable(), "Back did not return to calm on the player");
      if (tv) { await key("Escape"); assert(audit.router.state.location.pathname === "/now", "TV Back left before hiding the controls"); }
      await key("Escape");
      assert(audit.router.state.location.pathname !== "/now", "Back from calm did not leave the player");
    });
    await check("Info over Up next shows Info", async () => {
      await audit.go("/now", { player: "playing", live: true });
      document.querySelector<HTMLButtonElement>('[data-player-tools] button[aria-label="Up next"]')!.click(); await wait();
      assert(shown("[data-player-queue]"), "Up next did not open");
      dispatchTvRoute("info"); await wait(400);
      assert(!document.querySelector("[data-player-queue]") && expanded() && visibleText().includes("Experimental"), "Info over Up next did not show Info");
      dispatchTvRoute("info"); await wait(400);
      assert(!expanded() && focusIsUsable(), "The Remote's Info did not return to calm");
    });
    await check("the Remote's Info closes the Playback menu before showing Info", async () => {
      const gear = document.querySelector<HTMLButtonElement>('[data-player-tools] button[aria-label="Playback"]')!;
      gear.focus(); gear.click(); await wait(400);
      assert(document.querySelector('[data-player-menu]'), "Playback menu did not open");
      dispatchTvRoute("info"); await wait(600);
      assert(!document.querySelector('[data-player-menu][data-state="open"]') && expanded(), "Info left the menu open or did not show Info");
      toggle()!.click(); await wait();
    });
    await check("a programme boundary keeps Info and refreshes it", async () => {
      toggle()!.click(); await wait();
      const boundary = Date.now() + 1100;
      const current = { id: "boundary", title: "Boundary show", start: Date.now() - 1000, end: boundary, categories: ["Jazz"] };
      audit.client.setQueryData(programmes, { "audit-radio": { programmes: [current, { id: "new", title: "New transmission", start: boundary, end: boundary + 60000, categories: ["Ambient"] }], live: null } });
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, radioProgramme: { ...current, playbackId: "p", stationId: "audit-radio", provider: "xmltv", sampledAt: Date.now(), expiresAt: boundary } } }));
      assert(navigator.mediaSession.metadata?.title === "Boundary show" && expanded(), "Boundary fixture did not start in Info");
      await wait(1300);
      assert(document.querySelector("h1")?.textContent === "New transmission" && navigator.mediaSession.metadata?.title === "New transmission", "Info missed the boundary");
      assert(expanded() && visibleText().includes("Ambient") && !visibleText().includes("Jazz"), `The boundary reset Info or kept stale categories: ${expanded()} ${visibleText()}`);
      assert(!document.querySelector('[aria-label="Next programme"]')?.textContent?.includes("New transmission"), "The show on air is still listed as next");
      toggle()!.click(); await wait();
    });
    await check("another entry or Playback starts calm", async () => {
      await audit.go("/now", { player: "playing", live: true });
      toggle()!.click(); await wait();
      assert(expanded(), "Info did not open");
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, playback: "other", playbacks: gate.state!.playbacks!.map(playback => ({ ...playback, id: "other" })) } }));
      assert(!expanded() && !visibleText().includes("Experimental"), "A Playback switch kept Info");
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, playback: "p", playbacks: gate.state!.playbacks!.map(playback => ({ ...playback, id: "p" })) } }));
      assert(!expanded(), "Returning to a Playback reopened Info");
      toggle()!.click(); await wait();
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, currentEntryId: "next" } }));
      assert(!expanded() && focusIsUsable(), "An entry switch kept Info or lost focus");
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, currentEntryId: "concert" } }));
      assert(!expanded(), "Returning to an entry reopened Info");
      toggle()!.click(); await wait();
      await audit.go("/now", { player: "playing" });
      assert(!expanded(), "Changing an entry's source kept Info");
    });
    await check("focus in what Info hides moves to Info's button", async () => {
      await audit.go("/now", { player: "playing" });
      toggle()!.click(); await wait();
      const trail = document.querySelector<HTMLAnchorElement>("[data-player-audio-copy] [data-slot=breadcrumb-list] a");
      assert(trail?.checkVisibility(), "Info lacks the trail");
      trail!.focus(); await key("Escape");
      assert(!expanded() && document.activeElement === toggle(), "Focus in the trail was not handed to Info's button");
    });
    await check("a station without a guide keeps its tags for Info", async () => {
      await audit.go("/now", { player: "playing", live: true, fresh: true });
      audit.client.setQueryData(programmes, {});
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, radioProgramme: undefined } }));
      await wait(300);
      assert(document.querySelector("h1")?.textContent === "NTS Radio" && !visibleText().includes("Community"), "No-guide calm shows tags or lost the station");
      toggle()!.click(); await wait();
      assert(visibleText().includes("Community, Talk"), "No-guide Info lacks the station's tags");
      toggle()!.click(); await wait();
    });
    await check("a picture keeps its band; the Remote's Info shows and hides it", async () => {
      await audit.go("/now", { player: "paused", video: true });
      assert(!toggle() && !document.querySelector("#player-info"), "A picture got Info");
      const tools = [...document.querySelectorAll("[data-player-tools] button")].map(button => button.getAttribute("aria-label"));
      assert(tools.at(-1) === (tv ? "Playback" : "Enter fullscreen"), `Picture tools changed: ${tools.join(", ")}`);
      await key("i", document.querySelector("[data-player-surface]")!);
      assert(document.querySelector('[data-player-band="shown"]'), "I hid a picture's controls");
      dispatchTvRoute("info"); await wait(400);
      assert(document.querySelector('[data-player-band="hidden"]') && !document.activeElement?.closest("[data-player-band]"), "Info did not hide the picture's controls, or left focus in them");
      dispatchTvRoute("info"); await wait(400);
      assert(document.querySelector('[data-player-band="shown"]'), "Info did not show the picture's controls");
    });
    if (tv) await check("the Remote's Info elsewhere opens the player with Info", async () => {
      await audit.go("/", { player: "playing", live: true, fresh: true });
      dispatchTvRoute("info"); await wait(800);
      assert(audit.router.state.location.pathname === "/now" && expanded(), "Info from Home did not open the player with Info");
      await key("Escape");
      assert(!expanded() && audit.router.state.location.pathname === "/now", "Back did not return to calm");
    });
    if (innerHeight < 500) await check("a long programme title fits beside artwork in a short window", async () => {
      await audit.go("/now", { player: "paused", live: true, fresh: true });
      audit.client.setQueryData(programmes, { "audit-radio": { programmes: [{ id: "long-title", title: "Mild Animals - MILD HALLOWEEN", start: Date.now() - 60_000, end: Date.now() + 60_000 }], live: null } });
      await wait();
      const title = document.querySelector('h1 a')!.firstChild!;
      const range = document.createRange();
      const start = title.textContent!.indexOf("HALLOWEEN");
      range.setStart(title, start); range.setEnd(title, start + "HALLOWEEN".length);
      assert(range.getClientRects().length === 1, "The programme title splits a word across lines");
      const copy = document.querySelector('[data-player-audio-copy]')!.getBoundingClientRect();
      const station = document.querySelector('[data-player-audio-copy] [data-media-context] a')!.getBoundingClientRect();
      assert(station.top >= copy.top && station.bottom <= copy.bottom + 1, "The station link is clipped in the short player");
    });
    return { passed: true, tv, viewport: [innerWidth, innerHeight], checks };
  } finally { audit.close(); }
}
