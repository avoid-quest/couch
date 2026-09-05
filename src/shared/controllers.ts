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
