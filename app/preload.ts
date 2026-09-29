import { contextBridge, ipcRenderer } from "electron";

// The Couch window's bridge to Main (app/main.ts). The page may be this
// computer's Core (Full mode) or another Couch (Client mode).
const call = async (name: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke(`couch:${name}`, ...args) as { value?: unknown; error?: string };
  if (result.error !== undefined) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld("couchApp", {
  tvPresentation: process.argv.includes("--couch-tv-presentation"),
  mode: () => call("mode"),
  choose: (mode: string, address: string | null, confirm: boolean) => call("choose", mode, address, confirm),
  forget: (address: string) => call("forget", address),
  completeLocalSetup: () => call("complete-local-setup"),
  connection: () => call("connection"),
  interfaceSize: (size?: number) => call("interface-size", size),
  onAddresses: (listener: (urls: string[]) => void) => {
    const handler = (_event: unknown, urls: string[]) => listener(urls);
    ipcRenderer.on("couch:addresses", handler);
    return () => { ipcRenderer.off("couch:addresses", handler); };
  },
});
