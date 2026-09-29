import { contextBridge, ipcRenderer } from "electron";
import type { CouchApp, UpdateState } from "../src/shared/app-bridge";

// The Couch window's bridge to Main (app/main.ts). The page may be this
// computer's Core (Full mode) or another Couch (Client mode).
const call = async <T>(name: string, ...args: unknown[]): Promise<T> => {
  const result = await ipcRenderer.invoke(`couch:${name}`, ...args) as { value?: unknown; error?: string };
  if (result.error !== undefined) throw new Error(result.error);
  return result.value as T;
};

// The Mac window has no title bar: the page leaves room for its controls (index.css).
if (process.platform === "darwin" && !process.argv.includes("--couch-tv-presentation")) {
  const controls = (shown: boolean) => document.documentElement.toggleAttribute("data-window-controls", shown);
  addEventListener("DOMContentLoaded", () => controls(true));
  ipcRenderer.on("couch:full-screen", (_event, fullScreen: boolean) => controls(!fullScreen));
}

contextBridge.exposeInMainWorld("couchApp", {
  tvPresentation: process.argv.includes("--couch-tv-presentation"),
  mode: () => call("mode"),
  choose: (mode, address, confirm) => call("choose", mode, address, confirm),
  forget: address => call("forget", address),
  completeLocalSetup: () => call("complete-local-setup"),
  connection: () => call("connection"),
  interfaceSize: size => call("interface-size", size),
  onAddresses: listener => {
    const handler = (_event: unknown, urls: string[]) => listener(urls);
    ipcRenderer.on("couch:addresses", handler);
    return () => { ipcRenderer.off("couch:addresses", handler); };
  },
  updates: () => call("updates"),
  checkForUpdates: () => call("check-for-updates"),
  setUpdateChannel: channel => call("set-update-channel", channel),
  installUpdate: () => call("install-update"),
  onUpdates: listener => {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on("couch:updates", handler);
    return () => { ipcRenderer.off("couch:updates", handler); };
  },
  showLogs: () => call("show-logs"),
} satisfies CouchApp);
