export type SoundOutput = { id: string; name: string; state: string; availability: "available" | "unavailable" | "unknown"; muted: boolean; volume: number | null; testBlocked?: string | null; card?: string; bluetoothAddress?: string; volumeWritable?: boolean; muteWritable?: boolean; configurationAvailable?: boolean };
export type SoundInventory = { outputs: SoundOutput[]; defaultOutput: string | null; profiles?: SoundProfile[] };
export type SoundTest = { id: string; output: string; observedOutput: string | null; status: "starting" | "playing" | "finished" | "stopped" | "error"; endsAt: number; message: string | null };
export type SoundState = SoundInventory & { test: SoundTest | null; canTest: boolean; testUnavailableReason?: string; routing?: SoundRouteState; audioDelay?: number };

export type SoundRouteState = { selectedBluetoothAddress?: string; selectedOutput: string | null; observedOutput: string | null; volume: number | null; muted: boolean; error: string | null; volumeWritable?: boolean; muteWritable?: boolean; platform?: "mac" };

export type SoundProfile = { card: string; id: string; name: string; active: boolean; available: boolean; selectable: boolean; bluetoothAddress?: string };
export type SavedSoundProfile = { card: string; profile: string; bluetoothAddress?: string };
