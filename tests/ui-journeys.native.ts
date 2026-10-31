// bun tests/ui-journeys.native.ts <evidence directory> [--only=search,saved] [--width=390 --height=844] [--tv]
// Production routes and CSS, isolated fixture APIs. No installed Couch or network media is used.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { build, mergeConfig } from "vite";
import electron from "electron";
import config from "../vite.config";

const suites: Record<string, [string, string[]]> = {
  search: ["search-results.browser", ["runSearchResultsRegression", "runSearchResultStatesRegression", "runSeriesPlayRegression"]],
  navigation: ["search-navigation.browser", ["runSearchNavigationRegression"]],
  field: ["search-field.browser", ["runSearchFieldRegression"]],
  saved: ["saved-lists.browser", ["runSavedListsRegression"]],
  reorder: ["saved-reorder.browser", ["runSavedReorderRegression", "runSavedRenderingRegression"]],
  queue: ["player-queue.browser", ["runPlayerQueueRegression"]],
  bookmarks: ["save-for-later.browser", ["runSaveForLaterRegression"]],
  home: ["home-focus.browser", ["runHomeFocusRegression"]],
  cache: ["provider-cache.browser", ["runProviderCacheRegression"]],
  collection: ["collection-rendering.browser", ["runCollectionRenderingRegression", "runCollectionHistoryFreshnessRegression"]],
  stability: ["ui-audit.browser", ["runUiStabilityRegression"]],
  details: ["details-pending.browser", ["runDetailsPendingRegression"]],
  settings: ["settings-ui.browser", ["runSoundTestFocusRegression", "runSettingsPreviewRegression", "runAirPlayConnectionRegression", "runSettingsFeedbackRegression", "runPairingDialogRegression", "runSettingsActionsRegression", "runSettingsLayoutAudit"]],
  updates: ["update-shell.browser", ["runDisconnectedUpdateRegression", "runUpdateShellRegression"]],
  radio: ["radio-guides.browser", ["runRadioGuidesRegression", "runLiveRadioMetadataRegression"]],
  tv: ["tv-focus.browser", ["runTvFocusRegression", "runTvFocusReachability"]],
};
const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const tv = process.argv.includes("--tv");
const names = argument("only")?.split(",") ?? Object.keys(suites).filter(name => name !== "tv" || tv);
for (const name of names) if (!suites[name]) throw new Error(`Unknown suite: ${name}`);
const checks = names.flatMap(name => suites[name]![1]).filter(name => !argument("check") || name === argument("check"));
if (!checks.length) throw new Error("No checks selected");
const directory = resolve(process.argv[2] ?? ".artifacts/ui-journeys");
const entry = resolve(`src/client/__ui-journeys-${process.pid}.html`);
const outDir = join(directory, "dist");
mkdirSync(directory, { recursive: true });
writeFileSync(entry, `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="fixture"></div><script type="module">
import './index.css';
${names.map(name => `import { ${suites[name]![1].join(",")} } from '../../tests/${suites[name]![0]}';`).join("\n")}
window.checks = { ${checks.join(",")} };
</script></body></html>`);
try {
  await build(mergeConfig(config({ command: "build", mode: "production" }), {
    resolve: { alias: { "react-dom/client": "react-dom/profiling" } },
    define: { COUCH_TV_OVERRIDE: "true" },
    build: { outDir, rollupOptions: { input: entry } }, logLevel: "error",
  }));
} finally { rmSync(entry); }
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = resolve(outDir, "." + new URL(request.url).pathname);
  const file = Bun.file(path);
  return path.startsWith(outDir + sep) && await file.exists() ? new Response(file) : new Response(null, { status: 404 });
} });
const origin = `http://127.0.0.1:${server.port}`;
const probe = join(directory, "probe.cjs");
writeFileSync(probe, `
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
app.setPath('userData', ${JSON.stringify(join(directory, "data"))});
app.whenReady().then(async () => {
  const results = [];
  for (const name of ${JSON.stringify(checks)}) {
    // These fixtures exercise HTML fullscreen. player-fullscreen.native.ts tests
    // native window transitions with the real Main/preload and production player.
    const window = new BrowserWindow({ width: ${Number(argument("width") ?? 1440)}, height: ${Number(argument("height") ?? 900)}, useContentSize: true, enableLargerThanScreen: true, show: true, webPreferences: { backgroundThrottling: false, disableHtmlFullscreenWindowResize: true, partition: name } });
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, done) => done(new URL(request.url).origin === ${JSON.stringify(origin)} ? {} : request.resourceType === 'image' ? { redirectURL: ${JSON.stringify(origin + "/icons/pwa-512.png")} } : { cancel: true }));
    const timeout = setTimeout(() => window.destroy(), 180_000);
    const viewport = window.getContentBounds();
    try {
      if (viewport.width !== ${Number(argument("width") ?? 1440)} || viewport.height !== ${Number(argument("height") ?? 900)}) throw new Error("The test window was clamped: " + JSON.stringify(viewport));
      await window.loadURL(${JSON.stringify(`${origin}/${basename(entry)}${tv ? "?tv=1" : ""}`)});
      window.focus();
      const result = await window.webContents.executeJavaScript('window.checks[' + JSON.stringify(name) + ']()', true);
      const failures = Array.isArray(result) ? result.filter(check => check.passed === false || check.unreachable?.length || check.obscured?.length) : result?.checks?.filter?.(check => check?.passed === false);
      if (result?.passed === false || result?.failures?.length || failures?.length) throw new Error(JSON.stringify(result));
      results.push({ name, viewport, passed: true, result });
    } catch (error) { results.push({ name, viewport, passed: false, error: String(error) }); }
    finally { clearTimeout(timeout); if (!window.isDestroyed()) window.destroy(); }
    writeFileSync(${JSON.stringify(join(directory, "result.json"))}, JSON.stringify({ versions: process.versions, results }, null, 2));
    console.log(JSON.stringify(results.at(-1)));
  }
  app.exit(results.every(result => result.passed) ? 0 : 1);
});
app.on('window-all-closed', () => {});
`);
const env = { ...process.env, COUCH_DATA_DIR: join(directory, "data"), COUCH_PORT: String(server.port) };
delete env.ELECTRON_RUN_AS_NODE;
const child = Bun.spawn([electron, probe], { env, stdout: "inherit", stderr: "inherit" });
const timeout = setTimeout(() => child.kill(), checks.length * 185_000 + 30_000);
try { process.exitCode = await child.exited; }
finally { clearTimeout(timeout); child.kill(); server.stop(true); }
