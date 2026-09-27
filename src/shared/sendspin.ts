export type SendspinHostingState = {
  enabled: boolean;
  active: boolean;
  restartRequired: boolean;
  configuredExternally: boolean;
  error: string | null;
};
