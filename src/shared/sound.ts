export type SoundOutput = { id: string; name: string; state: string; availability: "available" | "unavailable" | "unknown"; muted: boolean; volume: number | null; testBlocked?: string | null };
export type SoundInventory = { outputs: SoundOutput[]; defaultOutput: string | null };
export type SoundTest = { id: string; output: string; observedOutput: string | null; status: "starting" | "playing" | "finished" | "stopped" | "error"; endsAt: number; message: string | null };
export type SoundState = SoundInventory & { test: SoundTest | null; canTest: boolean };
