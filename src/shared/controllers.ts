import type { PlayerState } from "./protocol";

export type ConnectionDetails = {
  lanError?: string | null; name: string; installationId?: string; urls: string[]; player: PlayerState["status"]; remoteControlEnabled?: boolean; tvPresentation?: boolean };

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
