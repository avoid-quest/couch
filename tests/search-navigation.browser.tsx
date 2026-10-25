// On an empty Vite fixture, import this module and call runSearchNavigationRegression().
// Uses the production route tree and read-only fixture APIs, with a cold destination held pending.
import { mountUiAudit } from "./ui-audit.browser";

const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

export async function runSearchNavigationRegression() {
  const audit = await mountUiAudit();
  const destination = audit.router.routesById["/saved"]!;
  const previous = { loader: destination.options.loader, pendingMs: destination.options.pendingMs };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let navigation: Promise<void> | undefined;
  try {
    await audit.go("/search?q=concert&kind=videos&source=YouTube");
    destination.update({ loader: () => pending, pendingMs: 10_000 });
    const before = audit.calls.length;
    navigation = audit.router.navigate({ href: "/saved?tab=later" });
    await wait();
    assert(audit.router.state.location.pathname === "/saved", "The destination must be pending at its new address");
    const search = document.querySelector('[data-page="Search"]');
    assert(search, "Search must remain mounted while the destination loads");
    const requests = audit.calls.slice(before).filter(path => /\/providers\/[^/]+\/items|\/radio\/stations\?/.test(path));
    assert(!requests.length, `Leaving Search started ${requests.length} extra source reads: ${requests.join(", ")}`);
    assert(search!.textContent?.includes("concert"), "The pending page lost its submitted query");
    assert(!search!.textContent?.includes("Bandcamp"), "The pending page lost its YouTube scope");
    release();
    await navigation;
    await wait();
    assert(!document.querySelector('[data-page="Search"]'), "The destination did not replace Search");
    await audit.go("/search?q=concert");
    assert(document.querySelector('[data-page="Search"]')?.textContent?.includes("Films and series"), "The unrestricted fixture has no film results to exclude");
    await audit.router.navigate({ href: "/search?q=concert&kind=audio" });
    await wait(350);
    const audio = document.querySelector('[data-page="Search"]');
    assert(audio && !audio.textContent?.includes("Films and series") && !audio.textContent?.includes("Films & series"), "Audio retained cached film results or their filter");
    assert(audio.textContent?.includes("Bandcamp") && audio.textContent?.includes("SoundCloud") && audio.textContent?.includes("YouTube"), "Audio lost a song source");
    return { passed: true, extraSourceReads: requests.length, audioScoped: true };
  } finally {
    release();
    await navigation;
    destination.update(previous);
    audit.close();
  }
}
