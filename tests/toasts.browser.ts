// In a paired scratch TV tab served by Vite, import this file through /@fs/ and call
// runToastRegression(readSessionGate, mediaUrl). Uses real Core commands and Sonner timers.
import type { SessionGateValue } from "../src/client/session/session-context";
import { applyTvNavigation } from "../src/client/navigation";
import { dismiss, queued, undoable } from "../src/client/toasts";
import { waitForTap } from "../src/client/session/renderer";

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

// Run on the requesting controller with a second, online Device that shares video.
export async function runPlayingOnRegression(gate: () => SessionGateValue, mediaUrl: string, targetDeviceId: string, delaySnapshots = false) {
  // Delay real state frames so a command result can arrive first, as on a slower connection.
  const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage")!;
  if (delaySnapshots) {
    Object.defineProperty(WebSocket.prototype, "onmessage", { ...descriptor, set(this: WebSocket, listener: WebSocket["onmessage"]) {
      descriptor.set!.call(this, (event: MessageEvent<string>) => {
        if (JSON.parse(event.data).type === "state") setTimeout(() => listener?.call(this, event), 150);
        else listener?.call(this, event);
      });
    } });
    gate().reconnect();
    await wait(500);
  }
  try {
    const name = gate().state?.devices?.find(device => device.id === targetDeviceId)?.name;
    assert(name, "The target device is unavailable");
    assert(await gate().run({ type: "enqueue", entry: { id: crypto.randomUUID(), title: "Remote toast regression", source: mediaUrl }, playNow: true, deviceId: targetDeviceId }), "Could not start remote playback");
    await wait(350);
    assert(messages().includes(`Playing on ${name}`), "The new snapshot dismissed its own Playing on confirmation");
    await wait(2_500);
    assert(messages().includes(`Playing on ${name}`), "Playing on did not retain its reading time");
    await wait(1_700);
    assert(!messages().includes(`Playing on ${name}`), "Playing on did not expire");
    return { passed: true };
  } finally {
    if (delaySnapshots) { Object.defineProperty(WebSocket.prototype, "onmessage", descriptor); gate().reconnect(); }
  }
}

export async function runTapToHearRecoveryRegression() {
  // Use the actual shell boundary, as the other browser fixtures read the live SessionGate.
  type Fiber = { type?: { name?: string }; stateNode?: { setState(state: { error: Error | null }): void }; child?: Fiber; sibling?: Fiber };
  const root = document.getElementById("root")! as unknown as Record<string, { stateNode: { current: Fiber } }>;
  const nodes = [root[Object.keys(root).find(key => key.startsWith("__reactContainer"))!]!.stateNode.current];
  let boundary: Fiber["stateNode"];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node.type?.name === "ShellErrorBoundary") { boundary = node.stateNode; break; }
    if (node.child) nodes.push(node.child);
    if (node.sibling) nodes.push(node.sibling);
  }
  assert(boundary, "No mounted shell boundary");
  let unlocked = false;
  try {
    waitForTap(() => { unlocked = true; });
    await wait(100);
    assert(messages().some(text => text.includes("Tap to hear")), "The initial audio prompt is missing");
    boundary!.setState({ error: new Error("Toast recovery regression") });
    await wait(200);
    const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Try again");
    assert(retry, "The real error boundary did not render recovery");
    retry!.click();
    await wait(350);
    const hear = [...document.querySelectorAll<HTMLButtonElement>('[data-sonner-toast]:not([data-removed="true"]) [data-button]')].find(button => button.textContent === "Tap to hear");
    assert(hear, "Tap to hear did not return after shell recovery");
    hear!.click();
    await wait(350);
    assert(unlocked && !messages().some(text => text.includes("Tap to hear")), "The recovered action did not unlock and dismiss");
    return { passed: true };
  } finally { waitForTap(null); boundary!.setState({ error: null }); }
}
