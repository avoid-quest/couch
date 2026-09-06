// Only the administrator diagnostics endpoint carries these observations.
export type DiagnosticFact = { name: string; value: string | number | null; source: string };
export type DiagnosticLog = { at: string; source: string; message: string };
export type NativeDiagnostics = {
  build: { version: string | null; revision: string | null; target: string | null; packaged: boolean };
  facts: DiagnosticFact[];
};
export type DiagnosticHelper = { name: string; version: string | null; status: "ready" | "error" | "unavailable"; source: string; error: string | null; checkedAt: string };
export type Diagnostics = {
  formatVersion: 1;
  collectedAt: string;
  collectionMs: number;
  build: NativeDiagnostics["build"];
  system: DiagnosticFact[];
  native: NativeDiagnostics | null;
  nativeError: string | null;
  helpers: DiagnosticHelper[];
  configuration: DiagnosticFact[];
  sources: { name: string; status: string; error: string | null }[];
  recent: DiagnosticLog[];
  limits: { recentEntries: number; messageCharacters: number; exportBytes: number; snapshotSeconds: number; helperSeconds: number };
};
