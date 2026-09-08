export const setupSteps = ["general", "display", "sound", "sources", "complete"] as const;
export type SetupStep = typeof setupSteps[number];
