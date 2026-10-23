// Run on an empty Vite fixture with #fixture. The real player, with a ticking clock.
import { mountUiAudit } from './ui-audit.browser';

export async function runPlayerClockRenderingRegression() {
  const audit = await mountUiAudit();
  const homeRows = localStorage.getItem('couch.home-rows');
  let artworkReads = 0;
  let closedPanelReads = 0;
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.matches('[aria-label="Playback"], [aria-label="Volume"], [aria-label="Where it plays"]') && this.getAttribute('aria-expanded') !== 'true') closedPanelReads++;
    return rect.call(this);
  };
  try {
    localStorage.setItem('couch.home-rows', '[{"id":"upNext","shown":true}]');
    window.dispatchEvent(new StorageEvent('storage', { key: 'couch.home-rows' }));
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
    for (const duration of [0, null]) {
      await audit.updateClock({ playbackId: 'p', position: 500, duration });
      const progress = document.querySelector('[data-home-hero] [role="progressbar"]');
      if (!progress || Math.abs(Number(progress.getAttribute('aria-valuenow')) - 500 / 900 * 100) > .001) throw new Error(`Home lost the known duration when the clock reported ${duration}`);
      const minutes = (text: string | null | undefined) => {
        const time = text?.match(/(\d{2}):(\d{2})$/);
        return time ? Number(time[1]) * 60 + Number(time[2]) : NaN;
      };
      const ends = minutes(progress.getAttribute('aria-label'));
      const until = minutes(document.querySelector('[data-home-board] section[aria-label="Up next"] header p')?.textContent);
      // The next fixture item lasts 15 minutes; both labels use the same wall clock, including at midnight.
      if ((until - ends + 1440) % 1440 !== 15) throw new Error(`Up next lost the remaining playback when the clock reported ${duration}: ends=${ends}, until=${until}`);
    }
    await audit.go('/now', { player: 'playing', live: true });
    if (document.querySelector('[data-player-ends]')) throw new Error('Live radio must not show an end time');
    await audit.go('/', { player: 'playing', live: true });
    if (document.querySelector('[data-home-hero] [role="progressbar"], [data-home-board] section[aria-label="Up next"] header p')) throw new Error('Live radio must not show Home progress or an Up next end time');
    return { passed: true, artworkReads, backgroundReads, closedPanelReads, firstEnd, secondEnd };
  } finally {
    Element.prototype.getBoundingClientRect = rect; audit.close();
    if (homeRows === null) localStorage.removeItem('couch.home-rows'); else localStorage.setItem('couch.home-rows', homeRows);
  }
}
