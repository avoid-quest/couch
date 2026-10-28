import { mountUiAudit } from "./ui-audit.browser";
import type { PlaybackPreview } from "../src/shared/playback-preview";
const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const preview: PlaybackPreview = { width: 160, height: 90, columns: 5, rows: 5, interval: 4.95, duration: 693, sheets: 6 };

// The real route tree and command path, no receiver. The native browser runner
// can replace these deterministic sprite bytes with real provider assets.
export async function preparePreviewRegression(imageUrl?: string) {
  const nativeFetch = window.fetch;
  const audit = await mountUiAudit();
  const fetch = window.fetch;
  const requests: { sheet: string | null; aborted: boolean }[] = [];
  let delay = 0, missing = false, denied = false, accepted = true, pending: ((value: boolean) => void) | undefined;
  const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 450;
  const context = canvas.getContext("2d")!;
  for (let i = 0; i < 25; i++) { context.fillStyle = `hsl(${i * 14} 70% 40%)`; context.fillRect(i % 5 * 160, Math.floor(i / 5) * 90, 160, 90); }
  const sprite = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
  // Fetch before replacing the UI audit stub when real image bytes are supplied.
  const real = imageUrl ? await nativeFetch(imageUrl).then(response => response.blob()) : undefined;
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname !== "/api/playback-preview") return fetch(input, init);
    const request = { sheet: url.searchParams.get("sheet"), aborted: false }; requests.push(request);
    if (delay) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      init?.signal?.addEventListener("abort", () => { request.aborted = true; clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
    });
    init?.signal?.throwIfAborted();
    if (denied) return new Response(null, { status: 404 });
    if (missing) return new Response(null, { status: 204 });
    return request.sheet === null ? Response.json(preview) : new Response(real ?? sprite, { headers: { "content-type": real?.type || "image/png" } });
  };
  await audit.go("/now", { player: "paused" });
  await audit.updateClock({ playbackId: "p", position: 120, duration: 693 });
  await audit.updateSession(gate => ({ ...gate, run: async action => {
    audit.actions.push(action);
    return delay ? new Promise<boolean>(resolve => { pending = resolve; }) : accepted;
  } }));
  return {
    audit, requests,
    options(value: { delay?: number; missing?: boolean; denied?: boolean; accepted?: boolean }) {
      delay = value.delay ?? 0; missing = value.missing ?? false; denied = value.denied ?? false; accepted = value.accepted ?? true;
    },
    respond(value: boolean) { pending?.(value); pending = undefined; },
    async source(id: string) {
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player, playbackId: id }, queue: gate.state!.queue.map((entry, i) => i ? entry : { ...entry, source: `web:https://www.youtube.com/watch?v=${id}` }) } }));
      await audit.updateClock({ playbackId: id, position: 30, duration: 693 });
    },
    close() { window.fetch = fetch; audit.close(); },
  };
}

export async function runPreviewRegression() {
  const fixture = await preparePreviewRegression();
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const track = () => document.querySelector('[role="slider"][aria-label="Playback position"]')!.closest('[data-slot="slider"]')!.parentElement!;
  const hover = (fraction: number) => {
    const element = track(), rect = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: rect.left + rect.width * fraction }));
  };
  try {
    assert(fixture.requests.length === 0, "Idle timeline fetched previews");
    hover(.1); await wait(200);
    const root = document.querySelector<HTMLElement>("[data-preview-thumbnail]");
    assert(root && !root.hasAttribute("data-error") && !root.hasAttribute("data-loading"), "Sprite never loaded");
    assert(fixture.audit.actions.length === 0, "Hover issued a command");
    const count = fixture.requests.length;
    for (let i = 0; i < 10; i++) { hover(.1 + i * .001); await wait(10); }
    assert(fixture.requests.length === count, "Every pointer move fetched an image");
    hover(-1); await wait(); assert(document.querySelector("[data-hover-time]")?.textContent === "0:00", "Left edge did not clamp");
    hover(2); await wait(); assert(document.querySelector("[data-hover-time]")?.textContent === "11:33", "Right edge did not clamp");
    const thumb = document.querySelector<HTMLElement>('[role="slider"][aria-label="Playback position"]')!;
    thumb.focus();
    thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); await wait();
    assert(fixture.audit.actions.at(-1)?.type === "seek", "Keyboard did not seek through Couch");
    assert(document.querySelector("[data-hover-time]")?.textContent === "2:10", "Keyboard draft did not drive preview");
    fixture.options({ accepted: false });
    thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); await wait();
    assert(thumb.getAttribute("aria-valuenow") === "120", "Rejected seek retained a draft");
    fixture.options({ delay: 500 });
    hover(.6); await wait(20);
    await fixture.source("replacement"); await wait(550);
    assert(!document.querySelector("[data-preview-thumbnail]"), "A stale image appeared on the new item");
    assert(fixture.requests.some(request => request.aborted), "Source change did not cancel the image request");
    fixture.options({ missing: true }); hover(.5); await wait(150);
    assert(!document.querySelector("[data-preview-thumbnail]"), "Missing assets did not fall back to timestamp");
    assert(!!document.querySelector("[data-hover-time]"), "Missing assets removed the timestamp");
    await fixture.audit.updateSession(gate => ({ ...gate, connected: false }));
    assert(!document.querySelector("[data-hover-time]"), "Disconnected timeline offered a preview");
    await fixture.audit.go("/now", { player: "playing", live: true });
    await fixture.audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player, seekable: false } } }));
    assert(!document.querySelector('[aria-label="Playback position"]'), "Non-seekable Live gained seeking");
    return { passed: true, requests: fixture.requests.length, canceled: fixture.requests.filter(request => request.aborted).length, seeks: fixture.audit.actions.filter(action => action.type === "seek").length };
  } finally { fixture.close(); }
}
