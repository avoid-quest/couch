import { existsSync } from "node:fs";
import type { SoundInventory } from "../shared/sound";
import { testTone, type SoundBackend } from "./sound-pulse";
import type { NativeSoundAction } from "./sound-native";

type NativeSound = (action: NativeSoundAction) => Promise<unknown>;
const mpv = `${process.env.COUCH_MPV_PREFIX ?? (process.arch === "arm64" ? "/opt/homebrew/opt/mpv" : "/usr/local/opt/mpv")}/bin/mpv`;

export function macSound(native: NativeSound) {
  const inventory = async () => {
    const value = await native({ op: "inventory" }) as SoundInventory;
    if (!Array.isArray(value?.outputs) || !value.outputs.every(output => typeof output.id === "string" && typeof output.name === "string")) throw new Error("Core Audio returned an invalid output list.");
    return value;
  };
  const route = async (pid?: number) => {
    const value = await native({ op: "route", ...(pid ? { pid } : {}) }) as { output: unknown };
    if (value?.output !== null && typeof value?.output !== "string") throw new Error("Core Audio returned an invalid playback route.");
    return value.output;
  };
  const running = new Map<number, { output: string; stop: () => void }>();
  const test: SoundBackend = {
    inventory,
    start(output) {
      const child = Bun.spawn([mpv, "--no-config", `--audio-device=coreaudio/${output}`, "--audio-fallback-to-null=yes", "--no-video", "--volume=100", "--demuxer=rawaudio", "--demuxer-rawaudio-format=s16le", "--demuxer-rawaudio-rate=48000", "--demuxer-rawaudio-channels=stereo", "-"], {
        stdin: testTone(), stdout: "ignore", stderr: "ignore", env: Object.fromEntries(["HOME", "PATH"].flatMap(name => process.env[name] ? [[name, process.env[name]!]] : [])),
      });
      const stop = () => child.kill();
      running.set(child.pid, { output, stop });
      void child.exited.finally(() => running.delete(child.pid));
      return { pid: child.pid, exited: child.exited, stop };
    },
    async route(pid) {
      const observed = await route(pid);
      const owned = running.get(pid);
      if (owned && observed && observed !== owned.output) { owned.stop(); return observed; }
      return observed;
    },
  };
  return {
    test,
    canTest: existsSync(mpv),
    routing: {
      inventory,
      route: () => route(),
      default: async (output: string) => { await native({ op: "default", output }); },
      volume: async (output: string, value: number) => { await native({ op: "volume", output, value: value / 100 }); },
      mute: async (output: string, value: boolean) => { await native({ op: "mute", output, value: Number(value) }); },
      profile: async (output: string, profile: string) => { await native({ op: "profile", output, profile }); },
    },
    subscribe(onEvent: () => void) { const timer = setInterval(onEvent, 750); timer.unref?.(); return { stop: () => clearInterval(timer) }; },
  };
}
