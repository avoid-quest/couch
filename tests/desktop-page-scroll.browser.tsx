// Mount with the production stylesheet in an isolated browser; no Couch or network.
import { createRoot } from "react-dom/client";
import { AppPage } from "../src/client/sections/shell/AppShell";
import { Stage } from "../src/client/components/Stage";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";

export function mountDesktopPageScroll({ overflow = false, nativeHost = true, tvPresentation = false, player = false, stage = true } = {}) {
  const root = createRoot(document.getElementById("root")!);
  root.render(<SessionGateContext value={{ nativeHost, tvPresentation } as SessionGateValue}>
    <div className="app-shell flex flex-col bg-background">
      <main className="flex flex-1 flex-col"><div className="tv-browser flex flex-1 flex-col">
        <header className="app-header sticky top-0 z-30 shrink-0 bg-background" style={{ height: "var(--top-bar)" }} hidden={player}>Header</header>
        <AppPage>{player ? <div className="player-page" /> : <div className="isolate min-w-0 flex-1 px-(--gutter) pt-8 pb-12">
          {stage ? <Stage thumbnail="" shape="square" title="Details"><h1>Details</h1></Stage> : <h1>Short page</h1>}
          {overflow && <><div style={{ height: 1200 }} /><button id="scroll-focus">Focus target</button><div style={{ height: 1200 }} /></>}
        </div>}</AppPage>
        <footer className="app-footer fixed inset-x-0 bottom-0 z-20 bg-background" style={{ height: "var(--bottom-bar)" }} hidden={player}>Footer</footer>
      </div></main>
    </div>
  </SessionGateContext>);
  return () => root.unmount();
}

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

// Run with html.electron, --top-bar:68px and --bottom-bar:56px. Vary viewport
// width and --interface-scale externally; trusted wheel/drag input stays with the browser driver.
export async function runDesktopPageScrollGeometryRegression() {
  for (const options of [{ stage: false }, {}, { overflow: true }]) {
    const close = mountDesktopPageScroll(options);
    try {
      await new Promise(resolve => setTimeout(resolve, 100)); // Radix's debounced resize measurement.
      const page = document.querySelector<HTMLElement>(".app-page")!;
      const header = document.querySelector(".app-header")!.getBoundingClientRect();
      const footer = document.querySelector(".app-footer")!.getBoundingClientRect();
      const track = document.querySelector('[data-slot="scroll-area-scrollbar"]')?.getBoundingClientRect();
      assert(page.matches('[data-scroll-restoration-id="app-page"][data-radix-scroll-area-viewport]'), "Navigation must restore the actual scrolling viewport");
      assert(page.offsetWidth === page.clientWidth, "The page must not reserve a scrollbar gutter");
      assert(Math.abs(page.getBoundingClientRect().right - innerWidth) < 1, "The page must fill the client width");
      const stage = document.querySelector(".stage")?.getBoundingClientRect();
      if (stage) assert(Math.abs(stage.top) < 1 && Math.abs(stage.right - innerWidth) < 1, "Artwork must reach behind the header and to the right edge");
      assert(!!track === (page.scrollHeight > page.clientHeight), "Only overflowing content gets a scrollbar");
      if (options.stage === false) assert(!track, "Short pages must not show a scrollbar");
      if (track) assert(Math.abs(track.top - header.bottom) < 1 && Math.abs(track.bottom - footer.top) < 1, "The scrollbar must clear the header and footer");
      assert(document.documentElement.scrollHeight === innerHeight, "The document must not scroll");
      const root = document.querySelector("#root")!;
      assert(root.scrollHeight === root.clientHeight, "The outer root must not acquire another scrollbar");
    } finally { close(); }
  }
  return "Passed: full-width viewport and artwork, no reserved gutter, scrollbar only for overflow, header/footer clearance and navigation restoration target.";
}
