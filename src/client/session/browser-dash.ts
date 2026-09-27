// DASH is loaded only for a selected HTTP(S) manifest, never for idle controllers.
export const isDashSource = (source: string) => {
  try { const url = new URL(source); return /^https?:$/.test(url.protocol) && /\.mpd$/i.test(url.pathname); } catch { return false; }
};

export interface DashPlayer {
  attach(video: HTMLMediaElement): Promise<unknown>;
  load(source: string, startTime?: number): Promise<unknown>;
  configure(config: { manifest: { disableText: boolean }; restrictions?: { maxHeight: number } }): unknown;
  addEventListener(type: string, listener: (event: any) => void): void;
  trickPlay(rate: number, useTrickPlayTrack?: boolean): void;
  destroy(): Promise<unknown>;
}
export interface DashLibrary {
  polyfill: { installAll(): void };
  Player: { new(): DashPlayer; isBrowserSupported(): boolean };
}
export const loadDashLibrary = async (): Promise<DashLibrary> => (await import("shaka-player")).default;
