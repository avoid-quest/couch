import { useSyncExternalStore } from "react";
import { couchApp } from "./session/native-context";
import { sentryDsn } from "../shared/sentry";

const key = "couch.error-reporting";
const changes = new EventTarget();
let enabled = false;

function applyReporting(value: boolean) {
  if (enabled === value) return;
  enabled = value;
  changes.dispatchEvent(new Event("change"));
}

function readBrowserPreference() {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

// Older desktop shells cannot grant consent for this installation.
export const canSetReporting = couchApp ? !!couchApp.errorReporting : !!sentryDsn;
if (couchApp) {
  void couchApp
    .errorReporting?.()
    .then(applyReporting)
    .catch(() => applyReporting(false));
} else if (typeof window !== "undefined") {
  applyReporting(readBrowserPreference());
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) applyReporting(readBrowserPreference());
  });
}

export async function saveReporting(value: boolean) {
  if (couchApp) {
    if (couchApp.errorReporting) applyReporting(await couchApp.errorReporting(value));
  } else {
    localStorage.setItem(key, String(value));
    applyReporting(value);
  }
}

export function subscribeReporting(listener: () => void) {
  changes.addEventListener("change", listener);
  return () => changes.removeEventListener("change", listener);
}

export const isReportingEnabled = () => enabled;
export const useErrorReporting = () =>
  useSyncExternalStore(subscribeReporting, isReportingEnabled, () => false);
