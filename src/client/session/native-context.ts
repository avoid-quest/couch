declare global {
  interface Window { __COUCH_NATIVE_HOST__?: boolean; __COUCH_TV_PRESENTATION__?: boolean }
}
declare const COUCH_DEV_ORIGIN: string | null;

// Tauri also marks external pages as isTauri. Only our bundled main window gets this marker.
// Native command permissions enforce authority independently of this presentation check.
export function isNativeHost() {
  return typeof window !== "undefined" && window.__COUCH_NATIVE_HOST__ === true
    && (location.protocol === "tauri:" && location.hostname === "localhost"
      || ["http:", "https:"].includes(location.protocol) && location.hostname === "tauri.localhost" && !location.port
      || typeof COUCH_DEV_ORIGIN !== "undefined" && COUCH_DEV_ORIGIN !== null && location.origin === COUCH_DEV_ORIGIN);
}

export const isTvPresentation = () => isNativeHost() && window.__COUCH_TV_PRESENTATION__ === true;
