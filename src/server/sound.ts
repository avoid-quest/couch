import type { ControllerIdentity } from "../shared/controllers";
import type { SoundState, SoundTest } from "../shared/sound";
import { ControllerError, settingField } from "./controllers";
import { pulseSound, type SoundBackend, type SoundProcess } from "./sound-pulse";

type Options = { routing?: ReturnType<typeof import("./sound-routing").createSoundRouting>; delay?: { get: () => number; set: (delay: number) => void }; available: boolean; testAvailable?: boolean; idle: () => boolean; begin: () => () => void; backend?: SoundBackend; platform?: "linux" | "mac" };
export function createSound(options: Options) {
  const backend = options.backend ?? pulseSound();
  let test: SoundTest | null = null;
  let active: { process: SoundProcess; timer: ReturnType<typeof setTimeout>; monitor: ReturnType<typeof setInterval>; release: () => void } | null = null;
  let starting = false;
  let closed = false;
  const finish = (status: SoundTest["status"], message: string | null = null) => {
    if (!active) return;
    const current = active; active = null;
    current.process.stop(); clearTimeout(current.timer); clearInterval(current.monitor); current.release();
    if (test) test = { ...test, status, message };
  };
  const state = async (): Promise<SoundState> => ({ ...await backend.inventory(), test, ...(options.routing ? { routing: options.routing.state } : {}), ...(options.delay ? { audioDelay: options.delay.get() } : {}), ...(options.testAvailable === false ? { testUnavailableReason: "A Mac sound test needs the mpv runtime on the selected playback host." } : {}), canTest: (options.testAvailable ?? options.available) && !closed && !starting && !active && options.idle() });
  return {
    async handle(request: Request, identity: () => ControllerIdentity | null) {
      const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
      const authorize = () => {
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this remote before connecting.", 401);
        if (caller.authority === "controller") throw new ControllerError("An administrator is required.", 403);
        if (closed) throw new ControllerError("The audio session is closing.", 503);
      };
      try {
        authorize();
        if (!options.available) return json({ error: options.platform === "mac" ? "The selected playback host cannot run a sound test. Check in System Settings on the playback host." : "Sound tests require the native Ubuntu TV audio session." }, 503);
        const path = new URL(request.url).pathname;
        if (path === "/api/sound/profile" && request.method === "POST" && options.routing) {
          const profile = await settingField(request, "profile"); authorize();
          if (starting || active) throw new ControllerError("Stop the sound test before changing output.", 409);
          await options.routing.profile(profile, authorize);
          return json(await state());
        }
        if (path === "/api/sound/output" && request.method === "POST" && options.routing) {
          const output = await settingField(request, "output"); authorize();
          if (starting || active) throw new ControllerError("Stop the sound test before changing output.", 409);
          await options.routing.select(output, authorize);
          return json(await state());
        }
        if (path === "/api/sound/delay" && request.method === "POST" && options.delay) {
          const delay = await settingField(request, "delay"); authorize();
          if (typeof delay !== "number" || !Number.isFinite(delay) || Math.abs(delay) > 60) throw new ControllerError("Use an audio delay between -60 and 60 seconds.", 400);
          options.delay.set(delay);
          return json(await state());
        }
        if (path === "/api/sound" && request.method === "GET") return json(await state());
        if (path === "/api/sound/stop" && request.method === "POST") {
          const id = await settingField(request, "testId"); authorize();
          if (!test || test.id !== id) throw new ControllerError("This sound test has ended.", 409);
          finish("stopped", "Sound test stopped.");
          return json(await state());
        }
        if (path !== "/api/sound/test" || request.method !== "POST") return json({ error: "Not found." }, 404);
        if (options.testAvailable === false) return json({ error: "A Mac sound test needs the mpv runtime on the selected playback host." }, 503);
        const output = await settingField(request, "output"); authorize();
        if (typeof output !== "string" || !output.length || output.length > 512) throw new ControllerError("Choose an available output.", 400);
        if (starting || active) throw new ControllerError("Stop the current sound test first.", 409);
        starting = true;
        try {
          const inventory = await backend.inventory(); authorize();
          if (!options.idle()) throw new ControllerError("Stop playback before testing sound. The test will not play over media.", 409);
          const sink = inventory.outputs.find(sink => sink.id === output);
          if (!sink || sink.availability === "unavailable") throw new ControllerError("That output is unavailable. Refresh the outputs.", 409);
          if (sink.testBlocked) throw new ControllerError(sink.testBlocked, 409);
          if (sink.muted) throw new ControllerError("That system output is muted. Unmute it before testing.", 409);
          const child = backend.start(sink.id);
          const id = crypto.randomUUID();
          test = { id, output: sink.id, observedOutput: null, status: "starting", endsAt: Date.now() + 3_000, message: null };
          let checking = false;
          const check = async () => {
            if (!active || test?.id !== id || checking) return;
            if (!options.idle()) { finish("stopped", "Playback started; the sound test stopped."); return; }
            checking = true;
            try {
              const route = await backend.route(child.pid);
              if (!active || test?.id !== id) return;
              if (route && route !== sink.id) { finish("error", "The test left the requested output and was stopped."); return; }
              if (route) test = { ...test, observedOutput: route, status: "playing" };
              else if (test.status === "playing") finish("error", "The test output disappeared; the test stopped.");
            } catch { if (active && test?.id === id) finish("error", "Could not verify the test output; the test stopped."); }
            finally { checking = false; }
          };
          active = { process: child, release: options.begin(), timer: setTimeout(() => finish(test?.observedOutput ? "finished" : "error", test?.observedOutput ? "Sound test ended. Confirm audibility yourself." : "The audio server never confirmed the test route."), 3_000), monitor: setInterval(() => void check(), 100) };
          void child.exited.then(code => { if (active?.process === child) finish(code === 0 && test?.observedOutput ? "finished" : "error", code === 0 && test?.observedOutput ? "Sound test ended. Confirm audibility yourself." : "The sound test could not complete."); });
          void check();
          return json(await state());
        } finally { starting = false; }
      } catch (error) {
        if (error instanceof ControllerError) return json({ error: error.message }, error.status);
        if (options.platform === "mac") return json({ error: error instanceof Error ? error.message : "Could not read or test sound on the Mac playback host." }, error instanceof Error && /unavailable|Check in System Settings/.test(error.message) ? 409 : 503);
        return json({ error: "Could not read or test the TV audio session. Check the Ubuntu audio service and try again." }, 503);
      }
    },
    interrupt() { if (!options.idle()) finish("stopped", "Playback or maintenance started; the sound test stopped."); },
    close() { closed = true; finish("stopped", options.platform === "mac" ? "The playback host is closing; the sound test stopped." : "The TV is closing; the sound test stopped."); },
  };
}
