import { contextBridge, ipcRenderer } from "electron";
import type { CouchApp, UpdateAction, UpdateState } from "../src/shared/app-bridge";

// The Couch window's bridge to Main (app/main.ts). The page may be this
// computer's Core (Full mode) or another Couch (Client mode).
const call = async <T>(name: string, ...args: unknown[]): Promise<T> => {
  const result = await ipcRenderer.invoke(`couch:${name}`, ...args) as { value?: unknown; error?: string };
  if (result.error !== undefined) throw new Error(result.error);
  return result.value as T;
};

// Desktop windows have no title bar: the page leaves room for their controls (index.css).
if (!process.argv.includes("--couch-tv-presentation")) {
  const controls = (shown: boolean) => {
    if (shown) document.documentElement.setAttribute("data-window-controls", process.platform === "darwin" ? "" : "overlay");
    else document.documentElement.removeAttribute("data-window-controls");
  };
  addEventListener("DOMContentLoaded", () => controls(true));
  ipcRenderer.on("couch:full-screen", (_event, fullScreen: boolean) => controls(!fullScreen));
  if (process.platform !== "darwin") addEventListener("DOMContentLoaded", () => {
    const root = document.documentElement;
    root.classList.add("electron", process.platform === "win32" ? "electron-windows" : "electron-linux");
    const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean; addEventListener(type: "geometrychange", listener: () => void): void } }).windowControlsOverlay;
    const sync = () => { root.classList.toggle("wco", overlay?.visible === true); controls(overlay?.visible === true); };
    sync();
    overlay?.addEventListener("geometrychange", sync);
  });
}

if (process.platform === "darwin" && !process.argv.includes("--couch-tv-presentation")) {
  // Electron's `swipe` is three-finger only. Two-finger scrolling supplies wheel
  // deltas and a native gestureScrollEnd; keep this adapter out of browsers and TV.
  let x = 0, y = 0, ignored = false, lastWheel = 0;
  const reset = () => { x = 0; y = 0; ignored = false; };
  addEventListener("wheel", event => {
    if (event.timeStamp - lastWheel > 250) reset();
    lastWheel = event.timeStamp;
    x += event.deltaX;
    y += Math.abs(event.deltaY);
    ignored ||= event.defaultPrevented || event.deltaMode !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    // A horizontal scroller owns the whole gesture, including its edges. Leave
    // text entry, sliders and native media controls to Chromium as well.
    ignored ||= event.composedPath().some(target => target instanceof Element && (
      target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-slot="slider"], [role="slider"], video[controls], audio[controls]')
      || (target.scrollWidth > target.clientWidth + 1 && /^(auto|scroll|overlay)$/.test(getComputedStyle(target).overflowX))
    ));
  }, { passive: true });
  ipcRenderer.on("couch:scroll-end", () => {
    if (!ignored && !document.body?.classList.contains("tv-presentation") && Math.abs(x) >= 100 && Math.abs(x) > y * 2) history.go(x < 0 ? -1 : 1);
    reset();
  });
}

contextBridge.exposeInMainWorld("couchApp", {
  tvPresentation: process.argv.includes("--couch-tv-presentation"),
  deviceName: name => call("device-name", name),
  deviceSharing: sharing => call("device-sharing", sharing),
  captureSources: () => call("capture-sources"),
  prepareCapture: selection => call("prepare-capture", selection),
  captureAccess: kind => call("capture-access", kind),
  openCaptureSettings: kind => call("capture-settings", kind),
  mode: () => call("mode"),
  choose: (mode, address, confirm) => call("choose", mode, address, confirm),
  forget: address => call("forget", address),
  completeLocalSetup: () => call("complete-local-setup"),
  connection: () => call("connection"),
  interfaceSize: size => call("interface-size", size),
  titleBarHeight: height => call("title-bar-height", height),
  onAddresses: listener => {
    const handler = (_event: unknown, urls: string[]) => listener(urls);
    ipcRenderer.on("couch:addresses", handler);
    return () => { ipcRenderer.off("couch:addresses", handler); };
  },
  onWindowClosed: listener => {
    const handler = () => listener();
    ipcRenderer.on("couch:window-closed", handler);
    return () => { ipcRenderer.off("couch:window-closed", handler); };
  },
  updates: () => update({ op: "read" }),
  update,
  checkForUpdates: () => update({ op: "check" }),
  setUpdateChannel: channel => update({ op: "channel", channel }),
  installUpdate: version => (version === undefined ? call("install-update") : update({ op: "install", version })).then(() => undefined),
  onUpdates: listener => {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on("couch:updates", handler);
    return () => { ipcRenderer.off("couch:updates", handler); };
  },
  showLogs: () => call("show-logs"),
  quit: () => call("quit"),
  reportPlayback: status => call("update-playback", status),
  shellReady: () => call("shell-ready"),
} satisfies CouchApp);

function update(action: UpdateAction) { return call<UpdateState>("update-action", action); }
