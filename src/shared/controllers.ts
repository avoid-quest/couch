import type { PlayerState } from "./protocol";

export type ConnectionDetails = {
  capabilities?: { browserPlayback: boolean; nativePlayback: boolean; restart?: boolean };
  lanError?: string | null; localSetupAvailable?: boolean; name: string; installationId?: string; urls: string[]; player: PlayerState["status"]; remoteControlEnabled?: boolean; desktopRemoteUi?: 1; desktopClientProtocol?: number; playbackClock?: 1; tvPresentation?: boolean };

export type Controller = {
  id: string;
  name: string;
  role: "controller" | "administrator";
  createdAt: number | null;
  lastSeenAt: number | null;
};

export type ControllerIdentity = {
  controller: Controller | null;
  authority: "host" | "administrator" | "controller";
  claimAvailable: boolean;
};
