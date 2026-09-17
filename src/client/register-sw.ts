import { isNativeHost } from "./session/native-context";

// Browser clients precache the app shell (#338). The Tauri webview keeps its
// native update path and must never register the worker, and origins without a
// secure context reject registration on their own.
export function registerAppShellWorker(document: Document = window.document) {
  if (isNativeHost() || !("serviceWorker" in navigator)) return false;
  document.defaultView?.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
  return true;
}
