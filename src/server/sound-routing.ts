import type { SoundInventory, SoundRouteState } from "../shared/sound";
import { ControllerError } from "./controllers";
import { pulseRouting } from "./sound-pulse";

type Options = {
  saved: () => string | null;
  save: (output: string) => void;
  active: () => boolean;
  pin: (output: string) => void;
  lost: (error: string) => void;
  changed: (state: SoundRouteState) => void;
  backend?: ReturnType<typeof pulseRouting>;
};

export function createSoundRouting(options: Options) {
  const backend = options.backend ?? pulseRouting();
  let selected = options.saved();
  let snapshot: SoundRouteState = { selectedOutput: selected, observedOutput: null, volume: null, muted: false, error: "Checking the TV audio session." };
  let closed = false, busy = false, changing = false;
  const publish = (value: SoundRouteState) => {
    if (closed) return;
    if (JSON.stringify(snapshot) === JSON.stringify(value)) return;
    snapshot = value; options.changed(value);
  };
  const output = (inventory: SoundInventory, name = selected) => inventory.outputs.find(output => output.id === name && output.availability !== "unavailable");
  const lost = (message: string) => {
    if (closed) return;
    publish({ ...snapshot, observedOutput: null, volume: null, error: message });
    if (options.active()) options.lost(message);
  };
  const refresh = async () => {
    const inventory = await backend.inventory();
    if (closed) return;
    if (!selected) {
      const initial = output(inventory, inventory.defaultOutput);
      if (!initial) throw new Error("No available system output.");
      options.save(initial.id); selected = initial.id;
    }
    const sink = output(inventory);
    if (!sink) { lost("The selected audio output is unavailable. Reconnect it or choose another output, then resume playback."); return; }
    if (sink.testBlocked) { lost("This audio server couples stream and system volume. Disable flat volumes before playback."); return; }
    const observed = await backend.route();
    if (closed) return;
    if (observed && observed !== selected) { lost("Couch left the selected audio output. Playback stopped. Choose an output and resume explicitly."); return; }
    publish({ selectedOutput: selected, observedOutput: observed, volume: sink.volume, muted: sink.muted, error: null });
  };
  const check = async () => {
    if (busy || closed) return;
    busy = true;
    try { await refresh(); }
    catch { lost("Cannot verify the TV audio output. Playback stopped. Check the Ubuntu audio service, then resume."); }
    finally { busy = false; }
  };
  const mutate = async (work: () => Promise<void>) => {
    if (busy || closed) throw new ControllerError("The audio session is busy. Try again.", 409);
    busy = true;
    try { await work(); await refresh(); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void check(), 500);
  void check();
  return {
    get state() { return { ...snapshot }; },
    check,
    prepare() {
      if (changing || closed || !selected || snapshot.error) throw new ControllerError(snapshot.error || "The audio output is changing. Try again.", 409);
      return selected;
    },
    async select(name: unknown, authorize: () => void) {
      if (typeof name !== "string" || !name || name.length > 512) throw new ControllerError("Choose an available output.", 400);
      await mutate(async () => {
        const inventory = await backend.inventory(); authorize();
        if (!output(inventory, name)) throw new ControllerError("That audio output is unavailable.", 409);
        if (output(inventory, name)?.testBlocked) throw new ControllerError("This audio server couples stream and system volume. Disable flat volumes before selecting this output.", 409);
        const previous = selected;
        const hadStream = await backend.route(); authorize();
        try {
          changing = true;
          options.pin(name);
          if (hadStream) {
            const deadline = Date.now() + 2_000;
            while (await backend.route() !== name) {
              if (closed || Date.now() >= deadline) throw new ControllerError("The audio server did not confirm the requested playback route.", 503);
              await Bun.sleep(50);
            }
          }
          authorize();
          await backend.default(name);
          if ((await backend.inventory()).defaultOutput !== name) throw new ControllerError("The audio server did not confirm the default output.", 503);
          authorize(); options.save(name); selected = name;
        } catch (error) {
          if (previous) options.pin(previous);
          if (inventory.defaultOutput) await backend.default(inventory.defaultOutput).catch(() => {});
          throw error;
        } finally { changing = false; }
      });
    },
    async volume(volume: number, authorize: () => void) {
      await mutate(async () => {
        const inventory = await backend.inventory(); authorize();
        if (!selected || !output(inventory)) throw new ControllerError("The selected output is unavailable.", 409);
        await backend.volume(selected, volume);
      });
    },
    async mute(muted: boolean, authorize: () => void) {
      await mutate(async () => {
        const inventory = await backend.inventory(); authorize();
        if (!selected || !output(inventory)) throw new ControllerError("The selected output is unavailable.", 409);
        await backend.mute(selected, muted);
      });
    },
    close() { closed = true; clearInterval(timer); },
  };
}
