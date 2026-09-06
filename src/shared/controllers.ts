import type { PlayerState } from "./protocol";

export type ConnectionDetails = { name: string; urls: string[]; player: PlayerState["status"] };

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
