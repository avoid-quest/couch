import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { resolve } from "node:path";
import { providerForUrl } from "../shared/providers";
import { helper, checkHelper, helperWorked, useHelper } from "./helpers";
import { streamingCommunityPlugin } from "./streamingcommunity";
import { soundCloudPlugin } from "./soundcloud";
import { createPublicMediaProxy } from "./public-media-proxy";

// Only fixed, public messages from the extractor may cross the catalog boundary.
export class ExtractionError extends Error {}

export type YtDlpOptions = { signal?: AbortSignal; timeoutMs?: number; plugin?: "streamingcommunity" };

let running = 0;
const waiting: Array<() => void> = [];

function acquireSlot(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (running < 3) { running++; return Promise.resolve(); }
  if (waiting.length >= 16) return Promise.reject(new ExtractionError("Too many website requests are waiting. Try again shortly."));
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

async function readOutput(stream: Readable, limit: number, kill: () => void): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      kill();
      stream.destroy();
      throw new ExtractionError("yt-dlp returned too much output. Update yt-dlp and try again.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

function extractionError(stderr: string): ExtractionError {
  if (/\bDRM\b|digital rights/i.test(stderr)) return new ExtractionError("This item requires DRM playback, which is not supported.");
  if (/not available in your country|geo.?restrict|geographic|geo.?block/i.test(stderr)) return new ExtractionError("This isn't available in your region.");
  if (/sign.?in|log.?in|authentication|cookies|private video|members.only|subscriber.only/i.test(stderr)) return new ExtractionError("This website requires an account or browser session. Website sign-in is not supported yet.");
  if (/Requested format is not available/i.test(stderr)) return new ExtractionError("This website offers no format Couch can play yet.");
  if (/not (?:currently )?live|offline|upcoming|premiere|scheduled/i.test(stderr)) return new ExtractionError("This live stream is offline or has not started yet.");
  if (/\bvideo (?:is unavailable|unavailable|has been removed|does not exist)\b/i.test(stderr)) return new ExtractionError("This video is unavailable or was removed.");
  return new ExtractionError("Couldn't open this page. It may be unsupported.");
}

function broken() {
  void checkHelper("yt-dlp");
  return new ExtractionError("yt-dlp won't start. Couch is repairing it; try again shortly.");
}

async function extract(command: string, quickjs: string, args: string[], signal: AbortSignal, proxy: string): Promise<string> {
  signal.throwIfAborted();
  const end = args.indexOf("--");
  const proxied = end < 0 ? [...args, "--proxy", proxy] : [...args.slice(0, end), "--proxy", proxy, ...args.slice(end)];
  // A file that isn't a program fails spawn itself on macOS (ENOEXEC).
  let child: ReturnType<typeof spawn>;
  try { child = spawn(command, ["--ignore-config", "--no-config-locations", "--no-plugin-dirs", "--no-warnings", "--skip-download", "--no-cache-dir", "--no-remote-components", "--color", "never", "--socket-timeout", "10", "--retries", "1", "--extractor-retries", "1", "--no-js-runtimes", "--js-runtimes", `quickjs:${quickjs}`, ...proxied], {
    // urllib can otherwise bypass even an explicit proxy for NO_PROXY hosts.
    env: { ...process.env, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy, NO_PROXY: "", no_proxy: "" },
    stdio: ["ignore", "pipe", "pipe"], signal, killSignal: "SIGKILL",
  }); } catch { throw broken(); }
  const exited = new Promise<number | null>((resolve, reject) => {
    // Aborting also reports an error; the signal check below explains that one.
    child.once("error", () => signal.aborted ? resolve(null) : reject(broken()));
    child.once("close", resolve);
  });
  const kill = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
  try {
    const [stdout, stderr, exitCode] = await Promise.all([readOutput(child.stdout!, 8 * 1024 * 1024, kill), readOutput(child.stderr!, 64 * 1024, kill), exited]);
    signal.throwIfAborted();
    // 126 and 127 come from the shell that execvp falls back to when the file isn't a program.
    if (exitCode === 126 || exitCode === 127) throw broken();
    if (exitCode !== 0) throw extractionError(stderr);
    return stdout;
  } finally { kill(); await exited.catch(() => {}); }
}

export async function runYtDlp(args: string[], options: YtDlpOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  // A first run waits here for its helper downloads, outside the website's deadline.
  // The yt-dlp copy stays on disk until this run ends, even if an update replaces it meanwhile.
  const ytDlp = await useHelper("yt-dlp");
  try { return await extractWith(ytDlp.path, args, options); }
  finally { ytDlp.release(); }
}

async function extractWith(command: string, args: string[], { signal, timeoutMs = 30_000, plugin }: YtDlpOptions): Promise<string> {
  const quickjs = await helper("qjs");
  const deadline = AbortSignal.timeout(timeoutMs);
  const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    await acquireSlot(cancellation);
    try {
      const target = args.at(-1) ?? "";
      const soundcloud = /^scsearch\d*:/.test(target) || providerForUrl(target) === "soundcloud";
      const bundled = plugin === "streamingcommunity" ? await streamingCommunityPlugin() : soundcloud ? await soundCloudPlugin() : null;
      try {
        const proxy = await createPublicMediaProxy(cancellation);
        // yt-dlp caches SoundCloud's public client ID and refreshes it on 401/403.
        // Keep it in Couch's data, so each search and playback needn't fetch the site's JS again.
        const settings = plugin === "streamingcommunity" ? ["--use-extractors", "StreamingCommunity,end", "--flat-playlist"]
          : soundcloud ? ["--cache-dir", resolve(process.env.COUCH_DATA_DIR ?? ".data", "yt-dlp-cache")] : [];
        try {
          const output = await extract(command, quickjs, [...(bundled ? ["--plugin-dirs", bundled.directory] : []), ...settings, ...args], cancellation, proxy.url);
          // Evidence that this yt-dlp copy works, beyond printing its version.
          helperWorked("yt-dlp", command, plugin ?? (soundcloud ? "soundcloud" : providerForUrl(target)) ?? "other");
          return output;
        }
        finally { await proxy.close(); }
      }
      finally { await bundled?.close(); }
    }
    finally { releaseSlot(); }
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new ExtractionError("The website took too long to respond. Try again.");
    throw error;
  }
}
