import { execFile } from "node:child_process";
import type { SoundInventory, SoundOutput, SoundProfile } from "../shared/sound";

type Card = { index: number; name: string; active_profile?: string; properties?: Record<string, string>; profiles?: Record<string, { description?: string; sinks?: number; sources?: number; available?: boolean }> };
type Sink = { card?: number; flags?: string[]; index: number; name: string; description?: string; state?: string; mute?: boolean; volume?: Record<string, { value: number }>; active_port?: string; ports?: { name: string; availability?: string }[] };
export type SoundProcess = { pid: number; exited: Promise<number>; stop: () => void };
export type SoundBackend = { inventory: () => Promise<SoundInventory>; start: (output: string) => SoundProcess; route: (pid: number) => Promise<string | null> };
const environment = () => Object.fromEntries(["HOME", "USER", "PATH", "XDG_RUNTIME_DIR", "PULSE_SERVER", "PULSE_COOKIE", "DBUS_SESSION_BUS_ADDRESS"].flatMap(name => process.env[name] ? [[name, process.env[name]!]] : []).concat([["LC_ALL", "C"]]));
export const querySound = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile("/usr/bin/pactl", args, { env: environment(), encoding: "utf8", timeout: 1_000, maxBuffer: 256 * 1024, killSignal: "SIGKILL" }, (error, stdout) => error ? reject(new Error("The TV audio session did not answer. Check PipeWire/PulseAudio and pulseaudio-utils.")) : resolve(stdout.trim()));
});

export function soundProfiles(value: unknown): SoundProfile[] {
  if (!Array.isArray(value)) throw new Error("The audio server returned invalid cards.");
  return value.slice(0, 128).flatMap((card: Card) => {
    if (typeof card.name !== "string" || !card.name || card.name.length > 512) throw new Error("Invalid audio card.");
    return Object.entries(card.profiles ?? {}).filter(([name]) => name.length <= 512)
      .map(([id, profile]) => ({ selectable: profile.sinks === 1 && profile.sources === 0 && id.startsWith("output:"), card: card.name, id, name: `${card.properties?.["device.description"] || card.name} · ${profile.description || id}`.slice(0, 200), active: card.active_profile === id, available: profile.available === true }));
  });
}

export function soundOutputs(value: unknown, cards: Card[] = []): SoundOutput[] {
  if (!Array.isArray(value)) throw new Error("The audio server returned an invalid output list.");
  return value.slice(0, 128).map((sink: Sink) => {
    if (typeof sink.name !== "string" || !sink.name || sink.name.length > 512 || typeof sink.index !== "number") throw new Error("The audio server returned an invalid output.");
    const availability = sink.ports?.find(port => port.name === sink.active_port)?.availability;
    const volumes = Object.values(sink.volume ?? {}).map(channel => channel.value).filter(value => Number.isFinite(value) && value >= 0);
    return { ...(cards.find(card => card.index === sink.card) ? { card: cards.find(card => card.index === sink.card)!.name } : {}), testBlocked: sink.flags?.includes("FLAT_VOLUME") ? "This audio server couples stream and system volume. Testing is unavailable to preserve your output level." : null, id: sink.name, name: (sink.description || sink.name).slice(0, 160), state: (sink.state || "Unknown").slice(0, 30), availability: availability === "available" || availability === "yes" ? "available" : availability === "not available" || availability === "no" ? "unavailable" : "unknown", muted: sink.mute === true, volume: volumes.length ? Math.round(Math.max(...volumes) / 65536 * 100) : null };
  });
}

export function testTone(): Uint8Array {
  // Three seconds, stereo PCM; 0.2 seconds of initial silence permits route readback.
  const frames = 48_000 * 3;
  const bytes = new Uint8Array(frames * 4);
  const samples = new DataView(bytes.buffer);
  for (let frame = 9600; frame < frames; frame++) {
    const second = frame / 48_000;
    const fade = Math.min(1, (second - 0.2) / 0.03, (3 - second) / 0.03);
    const sample = Math.round(Math.sin(2 * Math.PI * (second < 1.6 ? 440 : 660) * second) * 0.12 * 32767 * fade);
    samples.setInt16(frame * 4 + (second < 1.6 ? 0 : 2), sample, true);
  }
  return bytes;
}

export function pulseSound(): SoundBackend {
  return {
    async inventory() {
      const [sinks, selected, cards] = await Promise.all([querySound(["--format=json", "list", "sinks"]), querySound(["get-default-sink"]), querySound(["--format=json", "list", "cards"])]);
      return { outputs: soundOutputs(JSON.parse(sinks), JSON.parse(cards)), defaultOutput: selected || null, profiles: soundProfiles(JSON.parse(cards)) };
    },
    start(output) {
      const child = Bun.spawn(["/usr/bin/paplay", "--raw", "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=50", "--volume=65536", `--device=${output}`, "--client-name=Couch sound test", "--stream-name=Couch sound test"], { env: environment(), stdin: testTone(), stdout: "ignore", stderr: "ignore" });
      return { pid: child.pid, exited: child.exited, stop: () => { child.kill("SIGKILL"); } };
    },
    async route(pid) {
      const [inputs, sinks] = await Promise.all([querySound(["--format=json", "list", "sink-inputs"]), querySound(["--format=json", "list", "sinks"])]);
      const streams = JSON.parse(inputs) as { sink: number; properties: Record<string, string> }[];
      const owned = streams.filter(input => input.properties?.["application.process.id"] === String(pid));
      const routes = owned.map(stream => (JSON.parse(sinks) as Sink[]).find(sink => sink.index === stream.sink)?.name);
      if (routes.some(route => route !== routes[0])) throw new Error("The player's audio streams have different routes.");
      return routes[0] ?? null;
    },
  };
}

export function pulseRouting() {
  const backend = pulseSound();
  return {
    inventory: backend.inventory,
    // Only this native player's streams, never other applications or test tones.
    route: () => backend.route(process.ppid),
    async volume(output: string, volume: number) { await querySound(["set-sink-volume", output, `${volume}%`]); },
    async mute(output: string, muted: boolean) { await querySound(["set-sink-mute", output, muted ? "1" : "0"]); },
    async profile(card: string, profile: string) { await querySound(["set-card-profile", card, profile]); },
    async default(output: string) { await querySound(["set-default-sink", output]); },
  };
}
