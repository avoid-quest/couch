import { isNativeHost } from "./session/native-context";

// One root-scoped app-shell worker for browser remotes. The app window loads
// Core directly. Chrome refuses the worker while Core's self-signed certificate is
// only clicked through (#644 ticket 8), and the rejection is ignored.
export function registerAppShellWorker(document: Document = window.document) {
  const view = document.defaultView;
  if (import.meta.env.DEV || isNativeHost() || !view?.isSecureContext || !("serviceWorker" in view.navigator)) return false;
  const register = () => { void view.navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {}); };
  if (document.readyState === "complete") register();
  else view.addEventListener("load", register, { once: true });
  return true;
}
