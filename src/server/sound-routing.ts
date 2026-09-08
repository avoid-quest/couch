import type { SavedSoundProfile, SoundInventory, SoundRouteState } from "../shared/sound";
import { ControllerError } from "./controllers";
import { pulseRouting } from "./sound-pulse";

type Options = {
  saved: () => string | null;
  savedProfile?: () => SavedSoundProfile | null;
  save: (output: string, profile?: SavedSoundProfile | null) => void;
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
  const profileFor = (inventory: SoundInventory, name: string) => {
    const card = output(inventory, name)?.card;
    const profile = inventory.profiles?.find(profile => profile.card === card && profile.active);
    return profile ? { card: profile.card, profile: profile.id } : null;
  };
  const refresh = async () => {
    let inventory = await backend.inventory();
    if (closed) return;
    if (!selected) {
      const initial = output(inventory, inventory.defaultOutput);
      if (!initial) throw new Error("No available system output.");
      options.save(initial.id, profileFor(inventory, initial.id)); selected = initial.id;
    }
    const savedProfile = options.savedProfile?.();
    if (!output(inventory) && savedProfile && inventory.profiles?.some(profile => profile.card === savedProfile.card && profile.id === savedProfile.profile && profile.available && !profile.active)) {
      lost("Restoring the saved audio output. Resume playback when it becomes available.");
      await backend.profile(savedProfile.card, savedProfile.profile);
      inventory = await backend.inventory();
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
    while (busy && !closed) await Bun.sleep(10);
    if (closed) throw new ControllerError("The audio session is closing.", 503);
    busy = true;
    try { await work(); await refresh(); }
    finally { busy = false; }
  };
  const select = async (name: string, inventory: SoundInventory, authorize: () => void) => {
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
      authorize(); options.save(name, profileFor(inventory, name)); selected = name;
    } catch (error) {
      if (previous) options.pin(previous);
      if (inventory.defaultOutput) await backend.default(inventory.defaultOutput).catch(() => {});
      throw error;
    } finally { changing = false; }
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
      await mutate(async () => { const inventory = await backend.inventory(); authorize(); await select(name, inventory, authorize); });
    },
    async profile(value: unknown, authorize: () => void) {
      if (!value || typeof value !== "object" || !("card" in value) || !("profile" in value)) throw new ControllerError("Choose an available audio output profile.", 400);
      await mutate(async () => {
        const inventory = await backend.inventory(); authorize();
        const requested = inventory.profiles?.find(profile => profile.card === value.card && profile.id === value.profile && profile.available && profile.selectable);
        if (!requested) throw new ControllerError("That output profile is unavailable.", 409);
        const previous = inventory.profiles?.find(profile => profile.card === requested.card && profile.active);
        if (options.active()) options.lost("The audio output is changing. Resume playback after the output is ready.");
        changing = true;
        try {
          await backend.profile(requested.card, requested.id);
          const deadline = Date.now() + 2_000;
          let updated = await backend.inventory();
          while (!updated.profiles?.some(profile => profile.card === requested.card && profile.id === requested.id && profile.active) || !updated.outputs.some(output => output.card === requested.card && output.availability !== "unavailable")) {
            if (closed || Date.now() >= deadline) throw new ControllerError("The selected profile did not produce an available output.", 503);
            await Bun.sleep(50); updated = await backend.inventory();
          }
          authorize();
          const sink = updated.outputs.find(output => output.card === requested.card && output.availability !== "unavailable")!;
          await select(sink.id, updated, authorize);
        } catch (error) {
          if (previous) await backend.profile(previous.card, previous.id).catch(() => {});
          if (selected) options.pin(selected);
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
