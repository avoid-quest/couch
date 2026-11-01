// Production shell/router with isolated session data. Runs cold and repeated player navigation,
// optionally while decoding audio, with clock updates reaching the real UI consumers.
import { mountUiAudit } from "./ui-audit.browser";
import { setBuffered } from "../src/client/session/buffered";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;
const summarize = (gaps: number[]) => ({ frames: gaps.length, median: percentile(gaps, .5), p95: percentile(gaps, .95), max: Math.max(0, ...gaps), over60HzFloor: gaps.filter(gap => gap > 1000 / 60 + 1).length });

export async function runPlayerPerformance({ rounds = 40, clockMs = 250, audioUrl, navigation = 'player' }: { rounds?: number; clockMs?: number; audioUrl?: string; navigation?: 'player' | 'shell' } = {}) {
  const audio = audioUrl ? new Audio(audioUrl) : undefined;
  if (audio) { audio.loop = true; audio.volume = 0; await audio.play(); }
  const audit = await mountUiAudit();
  const fixtureFetch = window.fetch;
  window.fetch = (input, init) => new URL(String(input), location.href).pathname === '/api/artwork'
    ? fixtureFetch('/icons/pwa-512.png') : fixtureFetch(input, init);
  const original = document.startViewTransition.bind(document);
  const transitions: { started: number; ready: number; finished: number }[] = [];
  const errors: string[] = [];
  const frames: { gap: number; time: number; phase: string }[] = [];
  const ready: { phase: string; ms: number }[] = [];
  const longTasks: number[] = [];
  let phase = 'idle', frame = 0, previous = 0, clockTicks = 0;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let latest: ViewTransition | undefined;
  const tasks = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
  tasks.observe({ type: "longtask" });
  const tick = (time: number) => {
    if (previous) frames.push({ gap: time - previous, time: performance.now(), phase });
    previous = time;
    frame = requestAnimationFrame(tick);
  };
  document.startViewTransition = ((...args: Parameters<typeof original>) => {
    const sample = { started: performance.now(), ready: 0, finished: 0 };
    latest = original(...args);
    transitions.push(sample);
    latest.ready.then(() => { sample.ready = performance.now() - sample.started; }, error => errors.push(String(error)));
    latest.finished.then(() => { sample.finished = performance.now() - sample.started; });
    return latest;
  }) as typeof document.startViewTransition;
  const destinations = navigation === 'shell'
    ? [{ name: 'Saved', target: '[data-page="Saved"]' }, { name: 'Settings', target: '[data-page="Settings"]' }, { name: 'Remote', target: '[data-remote-page]' }]
    : [{ name: 'Now', target: '[data-player-band]' }];
  const travel = async (open: boolean, cold: boolean, page: typeof destinations[number]) => {
    phase = `${cold ? 'cold' : 'warm'}-${open ? 'open' : 'back'}-${page.name}`;
    performance.mark(`player-${phase}`);
    latest = undefined;
    const button = navigation === 'shell'
      ? [...document.querySelectorAll<HTMLAnchorElement>('[data-app-nav] a')].find(link => link.textContent === (open ? page.name : 'Home') && link.checkVisibility())
      : document.querySelector<HTMLButtonElement>(open ? '[data-now-playing] [data-player-last]' : '[data-player-top] button[aria-label^="Back to"]');
    if (!button) throw new Error(`Missing ${phase} button`);
    const target = open ? page.target : navigation === 'shell' ? '[data-page="Home"]' : '[data-now-playing]';
    let committed = 0;
    const observer = new MutationObserver(() => { if (!committed && document.querySelector(target)) committed = performance.now(); });
    observer.observe(document.getElementById('fixture')!, { childList: true, subtree: true });
    const started = performance.now();
    try {
      button.click();
      while (!committed) {
        if (performance.now() - started > 3000) throw new Error(`${phase} did not commit`);
        await wait(1);
      }
      ready.push({ phase, ms: committed - started });
      // Keep the same observation window for both snapshot transitions and compositor-only entry animations.
      if (latest) await Promise.race([latest.finished, wait(3000).then(() => { throw new Error('Transition timed out'); })]);
      await wait(Math.max(80, 450 - (performance.now() - started)));
    } finally { observer.disconnect(); }
  };
  try {
    await audit.go('/', { player: 'playing', live: true });
    const artwork = new URL('/icons/pwa-512.png', location.href).href;
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, queue: [{ ...gate.state!.queue[0]!, thumbnail: artwork }],
      devices: navigation === 'shell' ? gate.state!.devices.map(device => device.id === 'audit-tv' ? { ...device, tv: true } : device) : gate.state!.devices,
      radioProgramme: { playbackId: 'p', stationId: 'audit-radio', title: 'Evening radio session — independent music and conversations from the studio', artworkUrl: artwork, expiresAt: Date.now() + 3600000 },
    } }));
    await document.fonts.ready;
    await wait(500);
    longTasks.length = 0;
    if (clockMs) clockTimer = setInterval(() => { void audit.updateClock({ playbackId: 'p', position: ++clockTicks * clockMs / 1000, duration: null }); }, clockMs);
    frame = requestAnimationFrame(tick);
    await wait(250);
    for (const page of destinations) { await travel(true, true, page); await travel(false, true, page); }
    performance.mark('player-measure-start');
    for (let i = 0; i < rounds; i++) { const page = destinations[i % destinations.length]!; await travel(true, false, page); await travel(false, false, page); }
    performance.mark('player-measure-end');
    const warm = frames.filter(frame => frame.phase.startsWith('warm')).map(frame => frame.gap);
    const cold = summarize(frames.filter(frame => frame.phase.startsWith('cold')).map(frame => frame.gap));
    const steady = summarize(warm);
    const budget120 = 1000 / 120;
    const decoding = audio ? { currentTime: audio.currentTime, paused: audio.paused, readyState: audio.readyState } : undefined;
    if (decoding && (decoding.paused || decoding.readyState < 3 || !decoding.currentTime)) errors.push('Audio did not keep playing');
    return {
      environment: { userAgent: navigator.userAgent, width: innerWidth, height: innerHeight, dpr: devicePixelRatio, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches },
      navigation, rounds, clockMs, clockTicks, decoding, cold, idle: summarize(frames.filter(frame => frame.phase === 'idle').map(frame => frame.gap)),
      frames: warm.length, frameMs: { median: steady.median, p95: steady.p95, max: steady.max },
      // Allow 1ms of rAF timestamp/scheduling jitter around the two-refresh 60fps floor on a 120Hz display.
      over60HzFloor: steady.over60HzFloor, meets60HzFloor: !!warm.length && !cold.over60HzFloor && !steady.over60HzFloor && !errors.length,
      over120HzBudget: warm.filter(gap => gap > budget120 * 1.5).length,
      estimatedMissedFrames: warm.reduce((sum, gap) => sum + Math.max(0, Math.round(gap / budget120) - 1), 0),
      readyMs: { median: percentile(ready.map(t => t.ms), .5), p95: percentile(ready.map(t => t.ms), .95), max: Math.max(...ready.map(t => t.ms)) },
      longTasks, errors, transitions, ready,
      slowFrames: frames.filter(frame => frame.gap > budget120 * 1.5),
      meets120HzBudget: !!warm.length && cold.max <= budget120 * 1.5 && warm.every(gap => gap <= budget120 * 1.5) && !errors.length,
    };
  } finally {
    clearInterval(clockTimer); cancelAnimationFrame(frame); tasks.disconnect();
    document.startViewTransition = original; audit.close();
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  }
}

// Native runner supplies trusted mouse input; clock/buffer traffic reaches the production components.
export async function prepareSeekPerformance(audioUrl?: string) {
  let phase = 'setup', surface = 'bar', position = 120, frame = 0, previous = 0, moves = 0;
  const frames: { phase: string; gap: number }[] = [];
  const chapters: Record<string, number> = {}, geometry: Record<string, number> = {};
  const renders: Record<string, number[]> = {};
  const errors: string[] = [], longTasks: number[] = [];
  const audio = audioUrl ? new Audio(audioUrl) : undefined;
  if (audio) { audio.loop = true; audio.volume = 0; await audio.play(); }
  const audit = await mountUiAudit((_id, _kind, duration) => { (renders[phase] ??= []).push(duration); });
  const originalRect = Element.prototype.getBoundingClientRect;
  let watched: HTMLElement | null = null;
  Element.prototype.getBoundingClientRect = function () {
    if (this === watched || watched && !watched.hasAttribute('data-playback-seek') && this === watched.parentElement) geometry[phase] = (geometry[phase] ?? 0) + 1;
    return originalRect.call(this);
  };
  const pointerEvents: unknown[] = [];
  const capture = (event: Event) => {
    const e = event as PointerEvent, target = e.target;
    pointerEvents.push({ phase, type:e.type, buttons:e.buttons, trusted:e.isTrusted, target:target instanceof Element ? target.getAttribute('data-slot') ?? target.tagName : 'document', x:e.clientX, y:e.clientY });
  };
  for (const name of ['pointerdown','pointerup','gotpointercapture','lostpointercapture']) document.addEventListener(name,capture);
  const onMove = () => { moves++; };
  document.addEventListener('pointermove', onMove);
  const tasks = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
  tasks.observe({ type: 'longtask' });
  const tick = (time: number) => {
    if (previous && phase !== 'setup') frames.push({ phase, gap: time - previous });
    previous = time; frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const clock = setInterval(() => {
    position += .25;
    void audit.updateClock({ playbackId: 'p', position, duration: 900 });
    setBuffered({ playbackId: 'p', end: position + 60 });
  }, 250);
  let beforeDrag = 0;
  return {
    async surface(next: string) {
      phase = 'setup'; surface = next;
      await audit.go(next === 'bar' ? '/' : '/now', { player: 'playing' });
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player,
        chapters: Array.from({ length: 60 }, (_, i) => ({ title: `Chapter ${i + 1}`, get position() { chapters[phase] = (chapters[phase] ?? 0) + 1; return i * 15; } })),
      } } }));
      await document.fonts.ready; await wait(250);
      const thumb = document.querySelector<HTMLElement>('[role="slider"][aria-label="Playback position"]')!;
      watched = thumb.closest('[data-slot="slider"]')!;
      const rect = watched.getBoundingClientRect();
      return { x: rect.left, y: rect.top + rect.height / 2, width: rect.width };
    },
    begin(kind: string) {
      phase = `${surface}-${kind}`; performance.mark(`seek-${phase}`);
      if (kind === 'drag') beforeDrag = audit.actions.filter(action => action.type === 'seek').length;
    },
    beforeRelease() {
      if (audit.actions.filter(action => action.type === 'seek').length !== beforeDrag) errors.push('Drag sent seek commands before release');
      const value = Number(watched?.querySelector('[role="slider"]')?.getAttribute('aria-valuenow'));
      if (Math.abs(value - 765) > 4) errors.push(`${surface}: drag preview ended at ${value}, expected about 765`);
    },
    async afterRelease() {
      await wait(100);
      const seeks = audit.actions.filter(action => action.type === 'seek');
      if (seeks.length !== beforeDrag + 1 || Math.abs((seeks.at(-1)?.position ?? 0) - 765) > 4) errors.push('Release did not send exactly one seek to the drag target');
    },
    finish() {
      clearInterval(clock); cancelAnimationFrame(frame); tasks.disconnect();
      for (const name of ['pointerdown','pointerup','gotpointercapture','lostpointercapture']) document.removeEventListener(name,capture);
      document.removeEventListener('pointermove', onMove); Element.prototype.getBoundingClientRect = originalRect;
      const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor(values.length * p)] ?? 0;
      const stats = (values: number[]) => ({ frames: values.length, median: percentile(values, .5), p95: percentile(values, .95), max: Math.max(0, ...values), over60HzFloor: values.filter(value => value > 1000 / 60 + 1).length });
      const all = stats(frames.map(frame => frame.gap));
      const phases = Object.fromEntries([...new Set(frames.map(frame => frame.phase))].map(name => [name, { ...stats(frames.filter(frame => frame.phase === name).map(frame => frame.gap)), chapterReads: chapters[name] ?? 0, geometryReads: geometry[name] ?? 0, commits: renders[name]?.length ?? 0, renderMs: { total: (renders[name] ?? []).reduce((sum, ms) => sum + ms, 0), p95: percentile(renders[name] ?? [], .95) } }]));
      const decoding = audio ? { currentTime: audio.currentTime, paused: audio.paused, readyState: audio.readyState } : undefined;
      if (decoding && (decoding.paused || decoding.readyState < 3 || !decoding.currentTime)) errors.push('Audio did not keep playing');
      audit.close(); setBuffered(null);
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      return { environment: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, phases, moves, pointerEvents, seeks: audit.actions.filter(action => action.type === 'seek'), decoding,
        frameMs: { median: all.median, p95: all.p95, max: all.max }, over60HzFloor: all.over60HzFloor,
        meets60HzFloor: !all.over60HzFloor && !errors.length, meets120HzBudget: frames.every(frame => frame.gap <= 12.5) && !errors.length,
        errors, longTasks, slowFrames: frames.filter(frame => frame.gap > 12.5) };
    },
  };
}
