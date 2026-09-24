import type { SoundInventory } from "../shared/sound";
import type { NativeSoundAction } from "./sound-native";

type NativeSound = (action: NativeSoundAction) => Promise<unknown>;

export function windowsSound(native: NativeSound) {
  const inventory = async () => {
    const value = await native({ op: "inventory" }) as SoundInventory;
    if (!Array.isArray(value?.outputs) || !value.outputs.every(output => typeof output.id === "string" && typeof output.name === "string")) throw new Error("Windows Audio returned an invalid output list.");
    return value;
  };
  const route = async () => {
    const value = await native({ op: "route" }) as { output: unknown };
    if (value?.output !== null && typeof value?.output !== "string") throw new Error("Windows Audio returned an invalid playback route.");
    return value.output;
  };
  return {
    test: { inventory, start: () => { throw new Error("The Windows sound test is unavailable."); }, route },
    routing: {
      inventory, route,
      default: async () => {}, // Couch pins the WASAPI endpoint; public MMDevice has no system-default setter.
      volume: async (output: string, value: number) => { await native({ op: "volume", output, value: value / 100 }); },
      mute: async (output: string, value: boolean) => { await native({ op: "mute", output, value: Number(value) }); },
      profile: async (output: string, profile: string) => { await native({ op: "profile", output, profile }); },
    },
    subscribe(onEvent: () => void) { const timer = setInterval(onEvent, 750); timer.unref?.(); return { stop: () => clearInterval(timer) }; },
  };
}
