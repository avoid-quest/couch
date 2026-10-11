export type DisplayAction = { op: "read" } | { op: "preview"; output: string } | { op: "confirm" | "cancel"; token: string };
export type DisplayState = {
  outputs: { id: string; name: string; connected: boolean; width: number; height: number; x: number; y: number; refresh: number | null }[];
  saved: string | null;
  current: string | null;
  notice: string | null;
  preview: { token: string; expiresAt: number } | null;
};
