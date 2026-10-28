// Bundle with the production stylesheet in an isolated browser. The driver supplies synthetic captureSources
// on window.couchApp before loading the bundle, and sends trusted wheel/Tab/Escape input. No Core or real capture.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "../src/client/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "../src/client/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from "../src/client/components/ui/alert-dialog";
import { PairingDialog } from "../src/client/components/PairingDialog";
import { ShareButton } from "../src/client/sections/share/ShareControl";
import { KeyboardShortcuts } from "../src/client/sections/shell/KeyboardShortcuts";
import { ShellContext } from "../src/client/sections/shell/shell-context";
import type { ShellValue } from "../src/client/sections/shell/AppShell";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import type { LiveSelection } from "../src/shared/live-input";

export type DialogCase = "share" | "shortcuts" | "pairing" | "default" | "confirmation";
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const noop = () => {};

export async function mountDialogLayout(panel: DialogCase, tv = false) {
  const root = createRoot(document.getElementById("root")!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const originalFetch = window.fetch;
  window.fetch = async () => Response.json({ code: "123456" });
  document.body.classList.toggle("tv-presentation", tv);
  const captures: LiveSelection[] = [];
  const credentials = { origin: location.origin, token: "dialog-fixture" };
  const gate = {
    nativeHost: true, tvPresentation: tv, connected: true, status: "connected", credentials,
    state: { installationName: "Couch Dev QA", queue: [], player: { status: "idle" }, liveSources: [], playbacks: [],
      devices: [{ id: "qa-viewer", name: "Couch Dev QA", online: true, sharing: { audio: true, video: true } }] },
    liveSharing: { current: () => null }, endLive: async () => {}, run: async () => true, setError: noop, seekBy: noop,
    startLive: async (selection: LiveSelection) => { captures.push(selection); return { id: "fixture-source" }; },
  } as unknown as SessionGateValue;
  const shell = { section: "Home", changeSection: noop, focusSearch: noop, openPlayer: noop } as unknown as ShellValue;

  function Fixture() {
    const [open, setOpen] = useState(false);
    const openerRef = useRef<HTMLButtonElement>(null);
    let content;
    if (panel === "share") content = <ShareButton tv={tv}>Share</ShareButton>;
    else if (panel === "shortcuts") content = <>
      <Button ref={openerRef} onClick={() => setOpen(true)}>Open shortcuts</Button>
      <KeyboardShortcuts open={open} onOpenChange={setOpen} openerRef={openerRef} />
    </>;
    else if (panel === "pairing") content = <>
      <Button ref={openerRef} onClick={() => setOpen(true)}>Open pairing</Button>
      <PairingDialog credentials={credentials} urls={["https://couch-dev-qa.invalid", ...Array.from({ length: 24 }, (_, i) => `https://qa-${i}.invalid`)]} connected open={open} onOpenChange={setOpen} openerRef={openerRef} />
    </>;
    else if (panel === "confirmation") content = <AlertDialog>
      <AlertDialogTrigger asChild><Button>Open confirmation</Button></AlertDialogTrigger>
      <AlertDialogContent><AlertDialogTitle>Confirm list</AlertDialogTitle>
        <AlertDialogDescription>{Array.from({ length: 40 }, (_, i) => <span className="block" key={i}>List entry {i + 1}</span>)}</AlertDialogDescription>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>;
    else content = <Dialog>
      <DialogTrigger asChild><Button>Open default</Button></DialogTrigger>
      <DialogContent aria-describedby={undefined}><DialogTitle>Default dialog</DialogTitle>
        <DialogFooter><DialogClose asChild><Button>Done</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>;
    return <QueryClientProvider client={client}><SessionGateContext value={gate}><ShellContext value={shell}>
      <main className="p-6">{content}<div style={{ height: 1800 }} /><Button>Background action</Button></main>
    </ShellContext></SessionGateContext></QueryClientProvider>;
  }
  const rootRoute = createRootRoute({ component: Fixture });
  const router = createRouter({ routeTree: rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: "/" })]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  root.render(<RouterProvider router={router} />);
  await frame(); await frame();
  return { captures, close() { root.unmount(); client.clear(); window.fetch = originalFetch; } };
}

// A max-height in unscaled viewport pixels can look valid in computed styles yet paint outside the viewport.
// Assert rendered bounds, including the rem gutter, so this fails for the confirmed 1800×800 / Largest repro.
export function checkDialogBounds(panel: DialogCase) {
  const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"], [data-slot="sheet-content"]')!;
  if (!dialog) throw new Error("Missing production DialogContent");
  const style = getComputedStyle(dialog);
  const scale = Number(style.zoom);
  const gutter = parseFloat(getComputedStyle(document.documentElement).fontSize) * scale;
  const rect = dialog.getBoundingClientRect();
  if (panel === "share") for (const image of dialog.querySelectorAll<HTMLImageElement>('[data-slot="toggle-group-item"] img')) {
    const picture = image.parentElement!.getBoundingClientRect();
    const button = image.closest("button")!;
    const label = button.lastElementChild!.getBoundingClientRect();
    if (Math.abs(picture.width / picture.height - 16 / 9) > .05) throw new Error("Share thumbnail must retain its aspect ratio in narrow windows");
    if (label.bottom > button.getBoundingClientRect().bottom + 1) throw new Error("Share source name must fit its button");
  }
  if (dialog.dataset.slot === "sheet-content") {
    if (rect.top < -1 || rect.bottom > innerHeight + 1 || rect.height > innerHeight * .9 + 1) throw new Error("Share sheet escapes viewport");
    if (style.overflowY !== "auto") throw new Error("Share sheet must own vertical scrolling");
    return { rect: rect.toJSON(), maxHeight: style.maxHeight, clientHeight: dialog.clientHeight, scrollHeight: dialog.scrollHeight, scale, gutter: 0 };
  }
  if (rect.top < gutter - 1 || rect.bottom > innerHeight - gutter + 1) {
    throw new Error(`Dialog escapes viewport gutter: ${JSON.stringify(rect)}, viewport ${innerHeight}, scale ${scale}`);
  }
  const expected = Math.min(innerHeight / scale - 2 * gutter / scale, panel === "shortcuts" ? innerHeight * .85 : Infinity);
  if (Math.abs(parseFloat(style.maxHeight) - expected) > 1) throw new Error(`Wrong dialog cap: ${style.maxHeight}, expected ${expected}`);
  if (style.overflowY !== "auto") throw new Error("Dialog must own vertical scrolling");
  if (!dialog.getAttribute("aria-labelledby")?.split(" ").some(id => document.getElementById(id)?.textContent)) throw new Error("Missing accessible title");
  return { rect: rect.toJSON(), maxHeight: style.maxHeight, clientHeight: dialog.clientHeight, scrollHeight: dialog.scrollHeight, scale, gutter };
}
