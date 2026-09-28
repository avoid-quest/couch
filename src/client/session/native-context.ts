import type { InterfaceSize } from "../../shared/appearance";
import type { ConnectionInfo } from "../../shared/protocol";

// Full mode ("local") hosts Couch on this computer; Client mode ("remote") shows another Couch.
export type AppMode = { mode: "local" | "remote" | null; address: string | null; targets: string[]; localSetupComplete: boolean };
export type CouchApp = {
  tvPresentation: boolean;
  mode(): Promise<AppMode>;
  // null: the window is loading the chosen Couch.
  choose(mode: "local" | "remote", address: string | null, confirm: boolean): Promise<AppMode | null>;
  forget(address: string): Promise<AppMode | null>;
  completeLocalSetup(): Promise<AppMode>;
  connection(): Promise<ConnectionInfo>;
  interfaceSize(size?: InterfaceSize): Promise<InterfaceSize>;
  onAddresses(listener: (urls: string[]) => void): () => void;
};
declare global {
  interface Window { couchApp?: CouchApp }
}

// The Couch app's preload (app/preload.ts) adds this bridge to its own window only.
export const couchApp = typeof window === "undefined" ? undefined : window.couchApp;
export const isNativeHost = () => !!couchApp;
export const isTvPresentation = () => couchApp?.tvPresentation === true;
