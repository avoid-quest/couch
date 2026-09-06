import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clockFrame, guideClock } from "./iptv-clock";

export const appleGuideSample = "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8";
export const appleGuidePermission = "https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/StreamingMediaGuide/UsingHTTPLiveStreaming/UsingHTTPLiveStreaming.html";
type RequestRecord = { path: string; at: number; native: boolean; sequence?: number; sha256?: string; aborted?: number };

export async function createGuideFixture(port = 4202, ffmpeg = "ffmpeg") {
  const binary = Bun.which(ffmpeg); assert.ok(binary, "FFmpeg is available for the generated guide fixture");
  const directory = await mkdtemp(join(tmpdir(), "couch-iptv-streams-"));
  const encoders: Bun.Subprocess<"pipe", "ignore", "ignore">[] = [], writers: Promise<void>[] = [];
  const hashes: { name: string; sha256: string }[] = [], requests: RequestRecord[] = [];
  const waiting = new Set<() => void>();
  let closing = false, failure: unknown, server: Bun.Server<undefined> | undefined;
  const close = async () => {
    if (closing) return;
    closing = true;
    for (const release of [...waiting]) release();
    await server?.stop(true);
    for (const encoder of encoders) encoder.kill("SIGINT");
    const kill = setTimeout(() => { for (const encoder of encoders) if (encoder.exitCode === null) encoder.kill("SIGKILL"); }, 2_000);
    try { await Promise.all([...writers, ...encoders.map(encoder => encoder.exited)]); }
    finally { clearTimeout(kill); await rm(directory, { recursive: true, force: true }); }
  };
  try {
    const version = Bun.spawn([binary, "-version"], { stdout: "pipe", stderr: "ignore" });
    const ffmpegVersion = (await new Response(version.stdout).text()).split("\n")[0];
    assert.equal(await version.exited, 0);
    const ffmpegSha256 = createHash("sha256").update(await Bun.file(binary).bytes()).digest("hex");
    let started = Date.now(), monotonicStart = performance.now();
    const schedule = Math.floor(started / 3_600_000) * 3_600_000;
    let failed = false, revision = 1, slowReplacement = false, delayedSegments = 0;
    const currentSequence = async () => {
      const text = await Bun.file(join(directory, "blue.m3u8")).text();
      const sequence = [...text.matchAll(/blue-(\d+)\.ts/g)].at(-1)?.[1];
      assert.ok(sequence !== undefined, "Live guide manifest contains a published segment");
      return Number(sequence);
    };
    const logo = Bun.spawn([binary, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=green:size=32x32", "-frames:v", "1", join(directory, "logo.png")], { stdout: "ignore", stderr: "inherit" });
    assert.equal(await logo.exited, 0, "Generated guide logo encoding succeeds");
    // The runner constructs fixtures before other suites; encode only for guide qualification.
    const startStreams = async () => {
      if (encoders.length) return;
      started = Date.now(); monotonicStart = performance.now();
      try {
        for (const [color, frequency] of [["red", "440"], ["blue", "660"]] as const) {
          const encoder = Bun.spawn([binary, "-hide_banner", "-loglevel", "error", "-y",
            "-thread_queue_size", "8", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "640x360", "-framerate", "25", "-i", "pipe:0",
            "-re", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000`,
            "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "50", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "96k", "-shortest",
            "-f", "hls", "-hls_time", "2", "-hls_list_size", "6", "-hls_delete_threshold", "16", "-hls_flags", "delete_segments+independent_segments+temp_file",
            "-hls_segment_filename", join(directory, `${color}-%d.ts`), join(directory, `${color}.m3u8`),
          ], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
          encoders.push(encoder);
          writers.push((async () => {
            while (!closing) {
              const now = Date.now(), elapsed = now - started;
              assert.ok(Math.abs(elapsed - (performance.now() - monotonicStart)) < 100, "Fixture wall clock stays aligned with its monotonic clock");
              encoder.stdin.write(clockFrame(color, elapsed));
              await encoder.stdin.flush();
              await Bun.sleep(Math.max(1, now + guideClock.frameMs - Date.now()));
            }
          })().catch(error => { if (!closing) failure = error; }));
        }
        const deadline = Date.now() + 18_000;
        while (!await Bun.file(join(directory, "blue.m3u8")).exists() || !await Bun.file(join(directory, "red.m3u8")).exists()) {
          if (failure) throw failure;
          assert.ok(encoders.every(encoder => encoder.exitCode === null) && Date.now() < deadline, "Live guide encoders publish initial HLS segments");
          await Bun.sleep(50);
        }
      } catch (error) { await close(); throw error; }
    };
    const stamp = (time: number) => new Date(time).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
    const channels = [
      { id: "red", name: "Red signal", path: "/red/live.m3u8" },
      { id: "blue", name: "Blue signal", path: "/blue/live.m3u8" },
      { id: "slow", name: "Delayed signal", path: "/slow.m3u8" },
      { id: "apple", name: "Apple Bip Bop test", path: appleGuideSample },
    ];
    let origin = "";
    const manifest = async (color: string) => {
      if (failure) throw failure;
      const text = await Bun.file(join(directory, `${color}.m3u8`)).text();
      const delay = color === "blue" ? delayedSegments : 0;
      const first = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1] ?? 0);
      assert.ok(first >= delay, "Delayed live window is fully available");
      return text.replace(/#EXT-X-MEDIA-SEQUENCE:\d+/, `#EXT-X-MEDIA-SEQUENCE:${first - delay}`)
        .replace(/(?:red|blue)-(\d+)\.ts/g, (_match, sequence: string) => `/${color}/segments/${Number(sequence) - delay}.ts`);
    };
    server = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0, async fetch(req) {
      const path = new URL(req.url).pathname;
      const record: RequestRecord = { path, at: Date.now(), native: req.headers.get("user-agent") !== "Couch/0.1" };
      assert.ok(requests.length < 5_000, "Guide fixture request log remains bounded");
      requests.push(record);
      req.signal.addEventListener("abort", () => { record.aborted = Date.now(); }, { once: true });
      if (path === "/channels.m3u") return failed ? new Response("Source unavailable", { status: 503 }) : new Response("#EXTM3U\n" + channels.map(channel => `#EXTINF:-1 tvg-id="${channel.id}" tvg-logo="${origin}/logo.png?private=logo" group-title="${channel.id === "apple" ? "Public test" : "Generated signals"}",${channel.name}\n${channel.id === "apple" ? channel.path : origin + (channel.id === "slow" && slowReplacement ? "/blue/live.m3u8?replacement=1" : channel.path)}`).join("\n") + "\n");
      if (path === "/guide.xml") return failed ? new Response("Guide unavailable", { status: 503 }) : new Response(`<tv>${channels.map(channel => `<channel id="${channel.id}"><display-name>${channel.name}</display-name></channel>`).join("")}${channels.flatMap(channel => Array.from({ length: 192 }, (_, index) => {
        const start = schedule - 24 * 3_600_000 + index * 3_600_000;
        return `<programme channel="${channel.id}" start="${stamp(start)}" stop="${stamp(start + 3_600_000)}"><title>${channel.name} ${revision === 1 ? "caf&#233; &#xE9;" : "updated"} ${index}</title><desc>Generated schedule for playback qualification. This is not a broadcaster schedule.</desc></programme>`;
      })).join("")}</tv>`);
      if (path === "/logo.png") return new Response(Bun.file(join(directory, "logo.png")));
      if (path === "/slow.m3u8") {
        await new Promise<void>(resolve => { const release = () => { waiting.delete(release); resolve(); }; waiting.add(release); req.signal.addEventListener("abort", release, { once: true }); });
        return new Response(await manifest("red"), { headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
      }
      const live = /^\/(red|blue)\/live.m3u8$/.exec(path);
      if (live) return new Response(await manifest(live[1]!), { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
      const segment = /^\/(red|blue)\/segments\/(\d+)\.ts$/.exec(path);
      if (segment) {
        record.sequence = Number(segment[2]);
        const name = `${segment[1]}-${record.sequence}.ts`, file = Bun.file(join(directory, name));
        if (!await file.exists()) return new Response("Segment outside retained window", { status: 404 });
        const bytes = await file.bytes(); record.sha256 = createHash("sha256").update(bytes).digest("hex");
        if (!hashes.some(item => item.name === name)) hashes.push({ name, sha256: record.sha256 });
        return new Response(bytes, { headers: { "Content-Type": "video/mp2t" } });
      }
      return new Response("Unknown fixture", { status: 404 });
    } });
    origin = `http://127.0.0.1:${server.port}`;
    return { origin, definition: { name: "IPTV qualification", playlistUrl: `${origin}/channels.m3u?private=playlist`, guideUrl: `${origin}/guide.xml?private=guide` },
      hashes, currentSequence, startStreams, get epoch() { return started; }, encoding: { ffmpegVersion, ffmpegSha256, clock: guideClock }, requests: () => structuredClone(requests),
      delayLive(seconds: number) { assert.ok([0, 20].includes(seconds), "Live negative control uses a bounded twenty-second delay"); delayedSegments = seconds / 2; },
      set failed(value: boolean) { failed = value; },
      update() { revision++; }, replaceSlow() { slowReplacement = true; }, resetSlow() { slowReplacement = false; },
      releaseSlow() { for (const release of [...waiting]) release(); },
      close,
    };
  } catch (error) { await close(); throw error; }
}
export type GuideFixture = Awaited<ReturnType<typeof createGuideFixture>>;
