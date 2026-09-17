export type SourceCredentials = { origin: string; token: string };

export type SourceSettingsProps = {
  credentials: SourceCredentials | null;
  connected: boolean;
  canManage: boolean;
};

export type SourceKind =
  | "folders"
  | "jellyfin"
  | "radio"
  | "metadata"
  | "streaming-community"
  | "iptv";
