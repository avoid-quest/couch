import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { Readable } from "node:stream";
import type { AirPlayAvailability, AirPlayState } from "../shared/airplay";
import { createAudioIngress, createFramer, payloadType, type RtpPacket } from "./airplay-audio";

export type AirPlaySessions = {
  /** An admitted sender's sound has started: publish it as a source. */
  started: (id: string, sender: string) => void;
  /** Continuous 44.1 kHz stereo S16BE on Core's clock, silence included. */
  audio: (id: string, pcm: Buffer) => void;
  ended: (id: string) => void;
};

const restartWindow = 5 * 60_000, maxRestarts = 3;
const startTimeout = 20_000, quietLimit = 30 * 60_000;
export const airPlayPackages = "gstreamer1.0-plugins-base, gstreamer1.0-plugins-good, gstreamer1.0-plugins-bad, gstreamer1.0-libav and libplist-2.0-4";
const executable = (path: string) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };
const which = (name: string) => (process.env.PATH ?? "/usr/bin:/bin").split(delimiter).map(directory => join(directory, name)).find(executable);
// A sender names itself before it is admitted; keep only a short, printable label.
const label = (value: string) => value.replace(/\p{C}/gu, "").trim().slice(0, 60);

// UxPlay's own log, one line at a time. Its sound arrives separately, on fd 3.
function lines(stream: Readable, line: (text: string) => void) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    const parts = (pending + chunk).split("\n");
    pending = parts.pop()!;
    if (pending.length > 4096) pending = ""; // Not a line this reads
    for (const part of parts) if (part.length <= 4096) line(part.trim());
  });
}

// UxPlay keeps the AirPlay protocol, its password check and one sender at a time. Couch runs it
// only while an admin has turned it on, with the code as UxPlay's password (-pw): UxPlay sets up a
// sender's audio or mirroring only after its Digest authentication with it (lib/raop_handlers.h),
// which UxPlay's -pin pairing alone doesn't require. A sender counts as playing here only once
// its decoded sound arrives on a connection UxPlay authenticated.
// A sender is UxPlay's one RTSP (RAOP) connection, which it refuses to a second while one is open.
// Its debug log (-d 1, without packet data) names when that connection is made, when UxPlay
// authenticates it and when it is removed; other connections, such as one refused or one that only
// asks for /info, never hold a session.
// The log and the sound arrive on separate pipes, in no order between them, and UxPlay logs a removal
// before it stops that sender's decoding. So one UxPlay process serves one sender's sound: once an
// authenticated connection is removed, Couch ignores that process and starts another, and no
// sound it still sends can belong to whoever connects next. The pipe's framing is read from its
// first byte whoever the sound turns out to belong to.
export function createAirPlay(options: {
  executable?: string;
  directory: string;
  enabled: boolean;
  /** Share on network: UxPlay listens on every interface, so it runs only while the Couch is shared. */
  network: () => boolean;
  name: () => string;
  identity: () => { code: string; deviceId: string };
  sessions: AirPlaySessions;
  changed: () => void;
  log?: (line: string) => void;
  platform?: NodeJS.Platform;
  tools?: { setpriv?: string; stdbuf?: string };
}) {
  const log = options.log ?? (() => {});
  const supported = (options.platform ?? process.platform) === "linux";
  const tools = options.tools ?? { setpriv: which("setpriv"), stdbuf: which("stdbuf") };
  let enabled = options.enabled, closed = false, error: string | null = null;
  let child: ChildProcess | undefined, exited: Promise<void> | undefined, ready = false, name = "";
  let restarts: number[] = [], restartTimer: ReturnType<typeof setTimeout> | undefined;
  const stopping = new WeakSet<ChildProcess>();
  // Whether UxPlay has a sender connection now, and whether it authenticated it; the sender that
  // introduced itself on it names its session. spent: this UxPlay's authenticated sender left.
  let connected = false, authenticated = false, spent = false, sender = "", code = "";
  let session: { id: string; sender: string; ingress: ReturnType<typeof createAudioIngress>; timer: ReturnType<typeof setInterval>; media: number } | undefined;
  let pending = Promise.resolve();

  const unavailable = () => !supported ? "AirPlay receiving is available on Linux."
    : !options.executable || !executable(options.executable) ? "This Couch build doesn't include the AirPlay receiver."
    : !tools.setpriv || !tools.stdbuf ? "AirPlay needs setpriv and stdbuf (util-linux and coreutils) on this computer."
    : null;
  const state = (): AirPlayState => {
    const missing = unavailable();
    return {
      enabled,
      status: !supported ? "unsupported" : missing ? "unavailable" : !enabled ? "off" : !options.network() ? "waiting" : error ? "error" : session ? "receiving" : ready ? "ready" : "starting",
      error: missing ?? (enabled ? error : null),
      name: options.name(),
      code: options.identity().code,
      sender: session?.sender ?? null,
    };
  };

  const end = () => {
    if (!session) return;
    const { id, timer } = session;
    clearInterval(timer);
    session = undefined;
    log(`airplay ${id.slice(0, 8)} ended`);
    options.sessions.ended(id);
    options.changed();
  };
  const begin = () => {
    const id = crypto.randomUUID(), ingress = createAudioIngress();
    const current = session = { id, sender: sender || "AirPlay device", ingress, media: Date.now(), timer: setInterval(() => {
      const pcm = ingress.tick();
      if (session !== current) return;
      if (pcm.length) options.sessions.audio(id, pcm);
      // A sender that went quiet without UxPlay noticing has left.
      if (Date.now() - current.media > quietLimit) end();
    }, 20) };
    current.timer.unref();
    log(`airplay ${id.slice(0, 8)} receiving`);
    options.sessions.started(id, current.sender);
    options.changed();
  };
  const media = (packets: RtpPacket[]) => {
    // Sound is a sender's only on its authenticated connection, and only from the process that serves it.
    if (!packets.length || !session && !(connected && authenticated)) return;
    if (!session) begin();
    session!.media = Date.now();
    for (const packet of packets) session!.ingress.place(packet);
  };
  const line = (text: string) => {
    let match: RegExpExecArray | null;
    if (!ready && /^Initialized server socket/.test(text)) { ready = true; options.changed(); }
    // Each sender connection is its own session: one that follows another never continues it.
    else if (/^New connection \S+ identified as Connection type RAOP$/.test(text)) { end(); connected = true; authenticated = false; sender = ""; log("airplay sender connected"); }
    else if (connected && text === "Client authentication success") authenticated = true;
    else if (/^removing connection type RAOP socket \d+ /.test(text)) {
      end(); connected = false;
      log("airplay sender disconnected");
      if (authenticated) { authenticated = false; spent = true; recycle(); }
    }
    else if (match = /^connection request from (.*) \(.*\) with deviceID = /.exec(text)) { if (connected && !session) sender = label(match[1]!); }
    else if (match = /error while loading shared libraries: ([^:\s]+)/.exec(text)) error = `AirPlay needs ${label(match[1]!)}. Install ${airPlayPackages}.`;
    else if (/Required gstreamer (?:libav )?plugin/.test(text)) error = `AirPlay needs GStreamer. Install ${airPlayPackages}.`;
    // UxPlay exits when it can't announce itself; retrying wouldn't change the network.
    else if (/dnssd_register_(?:raop|airplay) failed|mDNSResponder .* failed/.test(text)) error = "AirPlay couldn't announce this Couch on the network. Allow multicast and UDP port 5353, then turn AirPlay off and on.";
  };

  const stop = async () => {
    clearTimeout(restartTimer);
    const current = child, done = exited;
    if (!current || !done) return;
    stopping.add(current);
    current.kill("SIGTERM");
    const kill = setTimeout(() => current.kill("SIGKILL"), 3_000);
    try { await done; } finally { clearTimeout(kill); }
  };
  const start = async () => {
    const directory = options.directory;
    await mkdir(join(directory, "cache"), { recursive: true, mode: 0o700 });
    const identity = options.identity(), startup = join(directory, "uxplayrc");
    name = options.name(); code = identity.code;
    ready = false; connected = false; authenticated = false; spent = false; sender = "";
    // The password is in UxPlay's own startup file (-rc), readable only by Couch, not on its command line.
    await writeFile(startup, `pw ${code}\n`, { mode: 0o600 });
    await chmod(startup, 0o600);
    // setpriv ends UxPlay with Core however Core ends; stdbuf lets Couch read its log as it happens.
    // Its home is Couch's data, so no ~/.uxplayrc or key outside it applies.
    const args = ["--pdeathsig", "KILL", "--", tools.stdbuf!, "-oL", "-eL", options.executable!, "-rc", startup,
      "-n", name, "-nh", "-vs", "0", "-d", "1", "-artp", `pt=${payloadType} ! rtpstreampay ! fdsink fd=3 sync=false`,
      "-key", join(directory, "key.pem"), "-m", identity.deviceId];
    const { UXPLAYRC: _rc, XDG_CONFIG_HOMEDIR: _config, ...environment } = process.env;
    const spawned = child = spawn(tools.setpriv!, args, { stdio: ["ignore", "pipe", "pipe", "pipe"], env: { ...environment, HOME: directory, XDG_CACHE_HOME: join(directory, "cache") } });
    exited = new Promise(resolve => { spawned.once("close", () => resolve()); spawned.once("error", () => resolve()); });
    const current = (text: string) => { if (child === spawned && !spent) line(text); };
    lines(spawned.stdout!, current);
    lines(spawned.stderr!, current);
    const frame = createFramer();
    (spawned.stdio[3] as Readable).on("data", (chunk: Buffer) => {
      if (child !== spawned || spent) return;
      const framed = frame(chunk);
      if (framed) media(framed.packets);
      else { log("airplay audio framing failed; restarting the receiver"); spawned.kill("SIGTERM"); }
    });
    spawned.once("error", () => { error = "Couch couldn't start the AirPlay receiver."; });
    const timeout = setTimeout(() => { if (child === spawned && !ready) { error = "The AirPlay receiver didn't start."; spawned.kill("SIGKILL"); } }, startTimeout);
    void exited.then(() => {
      clearTimeout(timeout);
      if (child !== spawned) return;
      child = undefined; exited = undefined;
      end(); connected = false; authenticated = false; ready = false;
      if (stopping.has(spawned) || closed || !enabled) { options.changed(); return; }
      const now = Date.now();
      restarts = [...restarts.filter(time => now - time < restartWindow), now];
      log(`airplay receiver stopped${error ? `: ${error}` : ""}`);
      if (!error && restarts.length > maxRestarts) error = "The AirPlay receiver keeps stopping. Turn AirPlay off and on to retry.";
      if (!error) restartTimer = setTimeout(() => void reconcile(), 1_000);
      options.changed();
    });
  };
  // One child at a time follows the switch, the name and the code; a failure waits for the admin.
  const reconcile = () => pending = pending.catch(() => {}).then(async () => {
    const want = enabled && !closed && options.network() && !unavailable();
    if (child && (!want || name !== options.name() || code !== options.identity().code)) await stop();
    if (!want || child || error) { options.changed(); return; }
    try { await start(); } catch { error = "Couch couldn't start the AirPlay receiver."; }
    options.changed();
  });

  // A planned restart: it doesn't count towards the receiver stopping on its own.
  function recycle() {
    log("airplay receiver restarting for the next sender");
    pending = pending.catch(() => {}).then(stop);
    void reconcile();
  }

  if (enabled) void reconcile();
  return {
    availability: (): AirPlayAvailability => !supported ? "unsupported" : unavailable() ? "unavailable" : "available",
    state,
    /** An admitted sender is connected, playing or paused. */
    active: () => !!session,
    async setEnabled(value: boolean) { enabled = value; error = null; restarts = []; await reconcile(); },
    /** Follow the installation's name, the code and Share on network. */
    async refresh() { await reconcile(); },
    /** After a new code: a device that knew the old one has to enter the new one. */
    async renew() { error = null; restarts = []; await reconcile(); },
    async close() { closed = true; end(); await reconcile(); },
  };
}
