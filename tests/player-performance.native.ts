// bun tests/player-performance.native.ts .artifacts/player-performance [--checks] [--trace] [--assert-budget=60] [--rounds=40]
// --seek drives playback, hover and native mouse drags (default: three rounds); --profile measures React render cost.
// An isolated Electron renderer, production CSS/routes and fixture API reads; COUCH_PERF_AUDIO adds local audio decoding.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, mergeConfig } from 'vite';
import electron from 'electron';
import config from '../vite.config';

const directory = resolve(process.argv[2] ?? '.artifacts/player-performance');
const checks = process.argv.includes('--checks');
const trace = process.argv.includes('--trace');
const seek = process.argv.includes('--seek');
const profile = process.argv.includes('--profile');
const argument = (name: string, fallback: number) => Number(process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const assertBudget = argument('assert-budget', process.argv.includes('--assert-budget') ? 120 : 0);
const rounds = argument('rounds', seek ? 3 : 40);
const clockMs = argument('clock-ms', 250);
const navigation = process.argv.includes('--shell-navigation') ? 'shell' : 'player';
const audioPath = process.env.COUCH_PERF_AUDIO;
const entry = resolve(`src/client/__player-performance-${process.pid}.html`);
const outDir = join(directory, 'dist');
mkdirSync(directory, { recursive: true });
writeFileSync(entry, `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="fixture"></div><script type="module">
import './index.css';
import { runPlayerPerformance } from '../../tests/player-performance.browser';
import { runPlayerTransitionRegression } from '../../tests/player-transition.browser';
import { runPlayerStatusRegression } from '../../tests/player-status.browser';
import { runArtworkMountRegression } from '../../tests/artwork-mount.browser';
import { runPlayerClockRenderingRegression } from '../../tests/player-clock-rendering.browser';
import { prepareSeekPerformance, runSeekBarRegression } from '../../tests/seek-bar.browser';
window.prepareSeek = () => prepareSeekPerformance(${JSON.stringify(audioPath ? '/benchmark.mp3' : undefined)});
window.runFixture = ${checks ? `async () => ({ checks: [await runArtworkMountRegression(), await runPlayerClockRenderingRegression(), await runPlayerTransitionRegression(), await runPlayerStatusRegression(), await runSeekBarRegression()] })` : `() => runPlayerPerformance(${JSON.stringify({ rounds, clockMs, navigation, audioUrl: audioPath ? '/benchmark.mp3' : undefined })})`};
</script></body></html>`);
try {
  await build(mergeConfig(config({ command: 'build', mode: 'production' }), {
    // Commit assertions and render-cost samples need React's profiling build; frame budgets use the ordinary release build.
    resolve: { alias: checks || profile ? { 'react-dom/client': 'react-dom/profiling' } : {} },
    build: { outDir, rollupOptions: { input: entry } },
    logLevel: 'error',
  }));
} finally { rmSync(entry); }
if (audioPath) copyFileSync(audioPath, join(outDir, 'benchmark.mp3'));

const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const path = resolve(outDir, '.' + pathname);
  if (!path.startsWith(outDir + '/')) return new Response(null, { status: 404 });
  const file = Bun.file(path);
  return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
} });
const probe = join(directory, 'probe.cjs');
writeFileSync(probe, `
const { app, BrowserWindow, screen, contentTracing } = require('electron');
const { writeFileSync } = require('node:fs');
app.setPath('userData', ${JSON.stringify(join(directory, 'data'))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: ${Number(process.env.COUCH_PERF_WIDTH ?? 1440)}, height: ${Number(process.env.COUCH_PERF_HEIGHT ?? 900)}, show: true, webPreferences: { backgroundThrottling: false } });
  const origin = ${JSON.stringify(`http://127.0.0.1:${server.port}`)};
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, done) => {
    if (new URL(request.url).origin === origin) done({});
    else done(request.resourceType === 'image' ? { redirectURL: origin + '/icons/pwa-512.png' } : { cancel: true });
  });
  let code = 0;
  try {
    await window.loadURL(${JSON.stringify(`http://127.0.0.1:${server.port}/${entry.split('/').at(-1)}`)});
    if (process.env.COUCH_PERF_REDUCED_MOTION === '1') {
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    }
    if (${trace}) await contentTracing.startRecording({ included_categories: ['devtools.timeline', 'blink', 'blink.user_timing', 'cc', 'viz', 'benchmark', 'toplevel'] });
    window.focus();
    let result;
    if (${seek} && !${checks}) {
      await window.webContents.executeJavaScript('window.prepareSeek().then(fixture => { window.seekFixture = fixture; })', true);
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let round = 0; round < ${rounds}; round++) for (const surface of ['bar', 'player']) {
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
        const rect = await window.webContents.executeJavaScript('window.seekFixture.surface(' + JSON.stringify(surface) + ')');
        const point = fraction => ({ x: Math.round(rect.x + rect.width * fraction), y: Math.round(rect.y) });
        await window.webContents.executeJavaScript("window.seekFixture.begin('playback')"); await wait(1000);
        await window.webContents.executeJavaScript("window.seekFixture.begin('hover')");
        for (let step = 0; step < 240; step++) {
          window.webContents.sendInputEvent({ type: 'mouseMove', ...point(.1 + .8 * step / 239) }); await wait(8);
        }
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point(.15) }); await wait(50);
        await window.webContents.executeJavaScript("window.seekFixture.begin('drag')");
        window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point(.15) });
        for (let step = 0; step < 240; step++) {
          window.webContents.sendInputEvent({ type: 'mouseMove', button: 'left', modifiers: ['leftButtonDown'], ...point(.15 + .7 * step / 239) }); await wait(8);
        }
        await window.webContents.executeJavaScript('window.seekFixture.beforeRelease()');
        window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point(.85) });
        await window.webContents.executeJavaScript('window.seekFixture.afterRelease()');
      }
      result = await window.webContents.executeJavaScript('window.seekFixture.finish()');
    } else result = await window.webContents.executeJavaScript('window.runFixture()', true);
    result.displayHz = screen.getDisplayMatching(window.getBounds()).displayFrequency;
    result.versions = process.versions;
    result.gpu = app.getGPUFeatureStatus();
    writeFileSync(${JSON.stringify(join(directory, 'result.json'))}, JSON.stringify(result, null, 2));
    if (${trace}) await contentTracing.stopRecording(${JSON.stringify(join(directory, 'trace.json'))});
    if (result.checks?.some(check => check.passed === false)) throw new Error('A browser regression failed; see result.json');
    console.log(JSON.stringify(result.checks ? { passed: true, checks: result.checks.length } : { frameMs: result.frameMs, cold: result.cold, over60HzFloor: result.over60HzFloor, over120HzBudget: result.over120HzBudget, estimatedMissedFrames: result.estimatedMissedFrames, readyMs: result.readyMs, longTasks: result.longTasks.length, errors: result.errors, meets60HzFloor: result.meets60HzFloor, meets120HzBudget: result.meets120HzBudget }));
    if (${assertBudget} && !result[${JSON.stringify(assertBudget === 60 ? 'meets60HzFloor' : 'meets120HzBudget')}]) code = 1;
  } catch (error) { console.error(error); code = 1; }
  app.exit(code);
});
`);
const env = { ...process.env, COUCH_DATA_DIR: join(directory, 'data'), COUCH_PORT: String(server.port) };
delete env.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn([electron, probe], { env, stdout: 'inherit', stderr: 'inherit' });
const timeout = setTimeout(() => { console.error('Renderer fixture timed out'); child.kill(); }, Math.max(60_000, rounds * (seek ? 20_000 : 1200) + 20_000));
try {
  process.exitCode = await child.exited;
  console.log(`Evidence: ${join(directory, 'result.json')}`);
} finally { clearTimeout(timeout); server.stop(true); }
