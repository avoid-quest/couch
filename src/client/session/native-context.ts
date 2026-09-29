
export type { AppMode, CouchApp } from "../../shared/app-bridge";
import type { CouchApp } from "../../shared/app-bridge";

declare global {
  interface Window { couchApp?: CouchApp }
}

// The Couch app's preload (app/preload.ts) adds this bridge to its own window only.
export const couchApp = typeof window === "undefined" ? undefined : window.couchApp;
export const isNativeHost = () => !!couchApp;
export const isTvPresentation = () => couchApp?.tvPresentation === true;
