// Run on an empty Vite fixture with #fixture. The real player, with a ticking clock.
import { mountUiAudit } from './ui-audit.browser';

export async function runPlayerClockRenderingRegression() {
  const audit = await mountUiAudit();
  let artworkReads = 0;
  let closedPanelReads = 0;
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.matches('[aria-label="Playback"], [aria-label="Volume"], [aria-label="Where it plays"]') && this.getAttribute('aria-expanded') !== 'true') closedPanelReads++;
    return rect.call(this);
  };
  try {
    await audit.go('/radio', { player: 'playing' });
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, queue: gate.state!.queue.map((entry, i) => i ? entry : new Proxy(entry, {
      get(target, property, receiver) { if (property === 'thumbnail') artworkReads++; return Reflect.get(target, property, receiver); },
    })) } }));
    artworkReads = 0;
    await audit.updateClock({ playbackId: 'p', position: 10, duration: 900 });
    await audit.updateClock({ playbackId: 'p', position: 20, duration: 900 });
    // The OS media-session bridge also reads the current artwork on clock ticks.
    const backgroundReads = artworkReads;
    await audit.router.navigate({ to: '/now' });
    await new Promise(resolve => setTimeout(resolve, 200));
    artworkReads = 0;
    closedPanelReads = 0;
    await audit.updateClock({ playbackId: 'p', position: 100, duration: 900 });
    const firstEnd = document.querySelector('[data-player-ends]')?.textContent;
    await audit.updateClock({ playbackId: 'p', position: 400, duration: 900 });
    const secondEnd = document.querySelector('[data-player-ends]')?.textContent;
    if (!firstEnd || !secondEnd || firstEnd === secondEnd) throw new Error('Playback clock stopped updating the end-time label');
    if (artworkReads > backgroundReads) throw new Error(`Clock ticks re-rendered the player artwork (${artworkReads} reads)`);
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player, volume: 60 } } }));
    if (closedPanelReads) throw new Error(`Playback updates measured closed panels (${closedPanelReads} reads)`);
    await audit.router.navigate({ to: '/' });
    await new Promise(resolve => setTimeout(resolve, 200));
    artworkReads = 0;
    await audit.updateClock({ playbackId: 'p', position: 450, duration: 900 });
    const firstProgress = document.querySelector('[data-home-hero] [role="progressbar"]')?.getAttribute('aria-valuenow');
    await audit.updateClock({ playbackId: 'p', position: 500, duration: 900 });
    const secondProgress = document.querySelector('[data-home-hero] [role="progressbar"]')?.getAttribute('aria-valuenow');
    if (firstProgress === secondProgress) throw new Error('Home progress stopped updating');
    if (artworkReads > backgroundReads) throw new Error(`Clock ticks re-rendered Home artwork (${artworkReads} reads)`);
    await audit.go('/now', { player: 'playing', live: true });
    if (document.querySelector('[data-player-ends]')) throw new Error('Live radio must not show an end time');
    return { passed: true, artworkReads, backgroundReads, closedPanelReads, firstEnd, secondEnd };
  } finally { Element.prototype.getBoundingClientRect = rect; audit.close(); }
}
