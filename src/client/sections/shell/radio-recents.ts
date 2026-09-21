import type { RadioStation } from "../../../shared/radio";

export const radioRecentsKey = (installationId: string) => `couch.radio-recents:${installationId}`;
export const readRadioRecents = (installationId: string): RadioStation[] => { try { return JSON.parse(localStorage.getItem(radioRecentsKey(installationId)) ?? "[]") as RadioStation[]; } catch { return []; } };
export const writeRadioRecents = (installationId: string, stations: RadioStation[]) => { try { localStorage.setItem(radioRecentsKey(installationId), JSON.stringify(stations)); } catch { /* Recents are best-effort. */ } };
