// In a paired scratch TV tab served by Vite, import this file through /@fs/ and call
// runToastRegression(readSessionGate, mediaUrl). Uses real Core commands and Sonner timers.
import type { SessionGateValue } from "../src/client/session/session-context";
import { applyTvNavigation } from "../src/client/navigation";
import { dismiss, queued, undoable } from "../src/client/toasts";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const messages = () => [...document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])')].map(node => node.textContent ?? "");
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

export async function runToastRegression(gate: () => SessionGateValue, mediaUrl: string) {
  assert(document.body.classList.contains("tv-presentation"), "Run in TV presentation (?tv=1)");
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
    finally { dismiss("queued"); dismiss("undo"); await wait(300); }
  };
  const enqueue = async (playNow: boolean) => {
    const id = crypto.randomUUID();
    assert(await gate().run({ type: "enqueue", entry: { id, title: "Toast regression film", source: mediaUrl }, playNow }), "Could not enqueue fixture");
    return id;
  };

  await check("TV hover cannot hold a toast open", async () => {
    queued("Toast regression film", () => {});
    await wait(100);
    const list = document.querySelector("[data-sonner-toaster]")!;
    list.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    list.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await wait(4_500);
    assert(!messages().some(text => text.startsWith("Queued")), "TV toast stayed after its deadline with a parked pointer");
  });
  await check("starting playback clears the previous Queue confirmation", async () => {
    const id = await enqueue(false);
    await wait(100);
    assert(messages().some(text => text.startsWith("Queued")), "Explicit Queue did not confirm");
    assert(await gate().run({ type: "play", entryId: id }), "Could not start fixture");
    await wait(350);
    assert(!messages().some(text => text.startsWith("Queued")), "Old Queue confirmation covers the new playback");
  });
  await check("a new item retires an older Undo", async () => {
    undoable("Removed the previous film.", () => {});
    // A command from another controller bypasses this window's run() cleanup.
    await gate().command({ type: "enqueue", entry: { id: crypto.randomUUID(), title: "Next film", source: mediaUrl }, playNow: true });
    await wait(350);
    assert(!messages().some(text => text.includes("Removed the previous film.")), "Old Undo survived a new item");
  });
  await check("Queue while playing still confirms and Up next works", async () => {
    await enqueue(false);
    await wait(100);
    const action = [...document.querySelectorAll<HTMLButtonElement>('[data-sonner-toast]:not([data-removed="true"]) [data-button]')].find(node => node.textContent === "Up next");
    assert(action, "Queue lost Up next");
    action!.click();
    await wait(350);
    assert(new URLSearchParams(location.search).get("queue") === "true", "Up next did not open the queue");
    assert(!messages().some(text => text.startsWith("Queued")), "Acted-on Queue did not dismiss");
  });
  await check("Stop keeps a working Undo reachable by remote", async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Close Up next"]')?.click();
    await wait(100);
    const id = await enqueue(true);
    assert(await gate().run({ type: "stop", playbackId: gate().state!.player.playbackId! }), "Could not stop fixture");
    await wait(350);
    const undo = document.querySelector<HTMLButtonElement>('[data-sonner-toast]:not([data-removed="true"]) [data-button]');
    assert(undo?.textContent === "Undo", "Stop lost its new Undo");
    const tab = document.querySelector<HTMLElement>('.app-header [aria-current="page"]')!;
    assert(tab, "Stop did not return to browsing");
    tab.focus();
    applyTvNavigation("up");
    assert(document.activeElement === undo, "Up past the header did not reach Undo");
    applyTvNavigation("back");
    assert(document.activeElement === tab, "Back from Undo did not restore focus");
    applyTvNavigation("up");
    applyTvNavigation("select");
    await wait(350);
    assert(gate().state?.currentEntryId === id, "Undo did not restore the stopped item");
    assert(!messages().some(text => text.startsWith("Stopped.")), "Undo stayed after activation");
  });
  return results;
}
