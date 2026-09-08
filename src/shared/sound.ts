export type SoundOutput = { id: string; name: string; state: string; availability: "available" | "unavailable" | "unknown"; muted: boolean; volume: number | null; testBlocked?: string | null; card?: string };
export type SoundInventory = { outputs: SoundOutput[]; defaultOutput: string | null; profiles?: SoundProfile[] };
export type SoundTest = { id: string; output: string; observedOutput: string | null; status: "starting" | "playing" | "finished" | "stopped" | "error"; endsAt: number; message: string | null };
export type SoundState = SoundInventory & { test: SoundTest | null; canTest: boolean; routing?: SoundRouteState; audioDelay?: number };

export type SoundRouteState = { selectedOutput: string | null; observedOutput: string | null; volume: number | null; muted: boolean; error: string | null };

export type SoundProfile = { card: string; id: string; name: string; active: boolean; available: boolean; selectable: boolean };
export type SavedSoundProfile = { card: string; profile: string };
