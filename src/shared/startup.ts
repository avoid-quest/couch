export type StartupState = {
  enabled: boolean;
  fullscreenAtLaunch: boolean;
  fullscreenNow: boolean | null;
  applies: "next-session";
};
