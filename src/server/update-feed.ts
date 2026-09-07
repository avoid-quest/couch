import type { ReleaseChannel, UpdateCandidate } from "../shared/updates";

export class UpdateError extends Error {}
export type UpdateRelease = { summary: UpdateCandidate; staged?: boolean };
export type UpdateFeed<T extends UpdateRelease = UpdateRelease> = { installationUnavailable?: string; check(channel: ReleaseChannel, signal: AbortSignal): Promise<T | null>; stage(candidate: T, signal: AbortSignal, progress?: (value: { received: number; total: number }) => void): Promise<void> };
