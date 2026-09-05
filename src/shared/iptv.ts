export type GuideSource = { id: string; name: string; channelCount: number; programCount: number; updatedAt: number | null; error: string | null };
export type GuideChannel = { id: string; sourceId: string; tvgId: string; name: string; group: string; hasLogo: boolean };
export type GuideProgram = { id: string; channelId: string; start: number; end: number; title: string; description: string };
export type GuideRow = GuideChannel & { now: GuideProgram | null; next: GuideProgram | null };
export type GuidePage = { channels: GuideRow[]; total: number; groups: string[]; sources: GuideSource[]; at: number };
