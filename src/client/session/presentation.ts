import { couchApp } from "./native-context";

// Vite defines it: true only in scratch builds (COUCH_TV_OVERRIDE=1) and the dev server, so release builds drop the override.
declare const COUCH_TV_OVERRIDE: boolean;

// A browser tab opts in with ?tv=1 and out with ?tv=0; the choice lasts for the tab's reloads (docs/design/tv.md).
const optedIn = () => {
  const choice = new URLSearchParams(location.search).get("tv");
  try {
    if (choice) sessionStorage.setItem("couch.tv-presentation", choice);
    return sessionStorage.getItem("couch.tv-presentation") === "1";
  } catch { return choice === "1"; }
};

// The one answer to "is this the TV presentation?", fixed for the page's life: the Couch app's TV window, or a tab
// that opted in, which then tells Core it is a TV like that window does.
const tv = couchApp?.tvPresentation === true || typeof COUCH_TV_OVERRIDE !== "undefined" && COUCH_TV_OVERRIDE && optedIn();
export const isTvPresentation = () => tv;
