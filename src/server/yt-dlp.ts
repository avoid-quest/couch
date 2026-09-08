import { streamingCommunityPlugin } from "./streamingcommunity";

export type YtDlpOptions = { signal?: AbortSignal; timeoutMs?: number; executable?: string; plugin?: "streamingcommunity" };

let running = 0;
const waiting: Array<() => void> = [];

function acquireSlot(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (running < 3) { running++; return Promise.resolve(); }
  if (waiting.length >= 16) return Promise.reject(new Error("Too many website requests are waiting. Try again shortly."));
  return new Promise((resolve, reject) => {
    const ready = () => { signal.removeEventListener("abort", abort); resolve(); };
    const abort = () => { waiting.splice(waiting.indexOf(ready), 1); reject(signal.reason); };
    waiting.push(ready);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

async function readOutput(stream: ReadableStream<Uint8Array>, limit: number, kill: () => void): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString();
      size += value.length;
      if (size > limit) {
        kill();
        await reader.cancel();
        throw new Error("yt-dlp returned too much output. Update yt-dlp and try again.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

function extractionError(stderr: string): Error {
  if (/\bDRM\b|digital rights/i.test(stderr)) return new Error("This item requires DRM playback, which is not supported.");
  if (/not available in your country|geo.?restrict|geographic|geo.?block/i.test(stderr)) return new Error("This media is unavailable in the player's region.");
  if (/sign.?in|log.?in|authentication|cookies|private video|members.only|subscriber.only/i.test(stderr)) return new Error("This website requires an account or browser session. Website sign-in is not supported yet.");
  if (/not (?:currently )?live|offline|upcoming|premiere|scheduled/i.test(stderr)) return new Error("This live stream is offline or has not started yet.");
  if (/JavaScript|JS runtime|challenge|EJS/i.test(stderr)) return new Error("This website needs a supported JavaScript runtime. Update yt-dlp and install Deno on the player.");
  return new Error("yt-dlp could not open this webpage. Check the link and update yt-dlp; this site or item may be unsupported.");
}

async function extract(command: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const deno = process.env.COUCH_DENO;
  let child;
  try {
    child = Bun.spawn({
      cmd: [command, "--ignore-config", "--no-config-locations", "--no-plugin-dirs", "--no-warnings", "--skip-download", "--no-cache-dir", "--no-remote-components", "--color", "never", "--socket-timeout", "10", "--retries", "1", "--extractor-retries", "1", ...(deno ? ["--js-runtimes", `deno:${deno}`] : []), ...args],
      stdin: "ignore", stdout: "pipe", stderr: "pipe", signal, killSignal: "SIGKILL",
    });
  } catch { throw new Error("yt-dlp could not be started. Check its installation on the player."); }
  const kill = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  try {
    const [stdout, stderr, exitCode] = await Promise.all([readOutput(child.stdout, 8 * 1024 * 1024, kill), readOutput(child.stderr, 64 * 1024, kill), child.exited]);
    signal.throwIfAborted();
    if (exitCode !== 0) throw extractionError(stderr);
    return stdout;
  } finally { kill(); await child.exited; }
}

export async function runYtDlp(args: string[], { signal, timeoutMs = 30_000, executable, plugin }: YtDlpOptions = {}): Promise<string> {
  signal?.throwIfAborted();
  const command = executable ?? process.env.COUCH_YT_DLP ?? Bun.which("yt-dlp");
  if (!command) throw new Error("Install yt-dlp on the player to open webpage links.");
  const deadline = AbortSignal.timeout(timeoutMs);
  const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    await acquireSlot(cancellation);
    try {
      const bundled = plugin === "streamingcommunity" ? await streamingCommunityPlugin() : null;
      try { return await extract(command, [...(bundled ? ["--plugin-dirs", bundled.directory, "--use-extractors", "StreamingCommunity,end", "--flat-playlist"] : []), ...args], cancellation); }
      finally { await bundled?.close(); }
    }
    finally { releaseSlot(); }
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new Error("The website took too long to respond. Try again.");
    throw error;
  }
}
