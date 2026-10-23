// The real shell/timeline: pointer previews must not recompute playback metadata or measure ignored input.
import { mountUiAudit } from './ui-audit.browser';

const wait = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export async function runSeekBarRegression() {
  const audit = await mountUiAudit();
  const failures: string[] = [];
  let chapterReads = 0, geometryReads = 0;
  const rect = Element.prototype.getBoundingClientRect;
  let watched: Element | null = null;
  Element.prototype.getBoundingClientRect = function () {
    if (this === watched) geometryReads++;
    return rect.call(this);
  };
  try {
    await audit.go('/now', { player: 'playing' });
    await audit.updateClock({ playbackId: 'p', position: 120, duration: 900 });
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player,
      chapters: Array.from({ length: 60 }, (_, i) => ({ title: `Chapter ${i + 1}`, get position() { chapterReads++; return i * 15; } })),
    } } }));
    await wait(200);
    const thumb = document.querySelector<HTMLElement>('[role="slider"][aria-label="Playback position"]')!;
    const track = thumb.closest('[data-slot="slider"]')!.parentElement!;
    const bounds = track.getBoundingClientRect();
    watched = track;
    const move = (fraction: number, pointerType = 'mouse') => track.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerType, pointerId: 1, clientX: bounds.left + bounds.width * fraction, clientY: bounds.top + bounds.height / 2,
    }));
    chapterReads = 0; geometryReads = 0;
    for (let i = 0; i < 12; i++) { move((i + 1) / 20); await nextFrame(); }
    await nextFrame();
    const hoverChapterReads = chapterReads;
    if (hoverChapterReads) failures.push(`Pointer previews recomputed chapter metadata ${hoverChapterReads} times`);
    if (thumb.getAttribute('aria-valuenow') !== '120' || audit.actions.some(action => action.type === 'seek')) failures.push('Hover changed the playback position');
    if (track.querySelector('[data-hover-time]')?.textContent !== '9:00') failures.push('Pointer preview did not show the time under it');
    await audit.updateClock({ playbackId: 'p', position: 120, duration: 1800 });
    if (track.querySelector('[data-hover-time]')?.textContent !== '18:00') failures.push('Pointer preview retained the previous duration');
    await audit.updateClock({ playbackId: 'p', position: 120, duration: 900 });
    // Touch must not measure or show a hover preview.
    track.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }));
    await nextFrame();
    geometryReads = 0;
    for (let i = 0; i < 12; i++) { move(.5, 'touch'); await nextFrame(); }
    const touchGeometryReads = geometryReads;
    if (touchGeometryReads) failures.push(`Touch input performed ${touchGeometryReads} hover geometry reads`);
    if (track.querySelector('[data-hover-time]')) failures.push('Touch displayed a hover preview');
    // Keyboard edits still use ten-second steps and retain the draft while clock observations arrive.
    if (!document.hasFocus()) throw new Error('The seek keyboard regression requires an active fixture window');
    thumb.focus();
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await wait();
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await wait();
    const seeks = audit.actions.filter(action => action.type === 'seek');
    if (seeks.length !== 2 || seeks[0]?.position !== 130 || seeks[1]?.position !== 140) failures.push('Keyboard seeking lost its cumulative ten-second steps');
    await audit.updateClock({ playbackId: 'p', position: 121, duration: 900 });
    if (thumb.getAttribute('aria-valuenow') !== '140') failures.push('Clock update displaced the keyboard draft');
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const deadline = performance.now() + 1000;
    while (thumb.getAttribute('aria-valuenow') !== '121' && performance.now() < deadline) await nextFrame();
    if (thumb.getAttribute('aria-valuenow') !== '121' || !document.activeElement?.matches('[data-play-button]')) failures.push(`Down did not hand focus to Play and restore the observed position: ${JSON.stringify({ value: thumb.getAttribute('aria-valuenow'), focus: document.activeElement?.getAttribute('aria-label'), documentFocused: document.hasFocus(), connected: thumb.isConnected })}`);
    await audit.updateSession(gate => ({ ...gate, connected: false }));
    geometryReads = 0;
    for (let i = 0; i < 12; i++) { move(.5); await nextFrame(); }
    const disabledGeometryReads = geometryReads;
    if (disabledGeometryReads) failures.push(`Disabled input performed ${disabledGeometryReads} hover geometry reads`);
    if (track.querySelector('[data-hover-time]')) failures.push('Disabled timeline displayed a hover preview');
    return { passed: !failures.length, failures, hoverChapterReads, touchGeometryReads, disabledGeometryReads };
  } finally { Element.prototype.getBoundingClientRect = rect; audit.close(); }
}

// Native runner supplies trusted mouse input; clock/buffer traffic reaches the production components.
export async function prepareSeekPerformance(audioUrl?: string) {
  const { setBuffered } = await import('../src/client/session/buffered');
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
    if (this === watched) geometry[phase] = (geometry[phase] ?? 0) + 1;
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
      watched = thumb.closest('[data-slot="slider"]')!.parentElement!;
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
