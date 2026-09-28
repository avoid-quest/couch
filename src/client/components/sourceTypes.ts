export type SourceCredentials = { origin: string; token: string };

export type SourceSettingsProps = {
  credentials: SourceCredentials | null;
  connected: boolean;
  canManage: boolean;
  /** The device name, for copy like "Folders on {name}". */
  hostName?: string;
};

export type SourceKind = "radio" | "streaming-community" | "iptv";
