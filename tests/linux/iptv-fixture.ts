import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const appleGuideSample = "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8";
export const appleGuidePermission = "https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/StreamingMediaGuide/UsingHTTPLiveStreaming/UsingHTTPLiveStreaming.html";
type RequestRecord = { path: string; at: number; native: boolean; sequence?: number; aborted?: number };

export async function createGuideFixture(port = 4202) {
  const directory = await mkdtemp(join(tmpdir(), "couch-iptv-streams-"));
  const run = async (args: string[]) => {
    const process = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "ignore", stderr: "inherit" });
    assert.equal(await process.exited, 0, "Generated IPTV stream encoding succeeds");
  };
  for (const [color, frequency] of [["red", "440"], ["blue", "660"]]) await run([
    "-f", "lavfi", "-i", `color=c=${color}:size=640x360:rate=25`, "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000`,
    "-t", "12", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "50", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "96k",
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "0", "-hls_segment_filename", join(directory, `${color}-%d.ts`), join(directory, `${color}.m3u8`),
  ]);
  await run(["-f", "lavfi", "-i", "color=c=green:size=32x32", "-frames:v", "1", join(directory, "logo.png")]);
  const hashes = await Promise.all((await readdir(directory)).sort().map(async name => ({ name, sha256: createHash("sha256").update(await Bun.file(join(directory, name)).bytes()).digest("hex") })));
  const started = Date.now(), schedule = Math.floor(started / 3_600_000) * 3_600_000;
  let failed = false, revision = 1, slowReplacement = false;
  const requests: RequestRecord[] = [];
  const waiting = new Set<() => void>();
  const currentSequence = () => 12 + Math.floor((Date.now() - started) / 2000);
  const stamp = (time: number) => new Date(time).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
  const channels = [
    { id: "red", name: "Red signal", path: "/red/live.m3u8" },
    { id: "blue", name: "Blue signal", path: "/blue/live.m3u8" },
    { id: "slow", name: "Delayed signal", path: "/slow.m3u8" },
    { id: "apple", name: "Apple Bip Bop test", path: appleGuideSample },
  ];
  let origin = "";
  const manifest = (color: string) => {
    const end = currentSequence(), start = end - 5;
    return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${start}\n#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(start / 6)}\n` + Array.from({ length: 6 }, (_, index) => {
      const sequence = start + index;
      return `${sequence % 6 === 0 && index > 0 ? "#EXT-X-DISCONTINUITY\n" : ""}#EXTINF:2.0,\n/${color}/segments/${sequence}.ts\n`;
    }).join("");
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    const record: RequestRecord = { path, at: Date.now(), native: req.headers.get("user-agent") !== "Couch/0.1" };
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
      return new Response(manifest("red"), { headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
    }
    const live = /^\/(red|blue)\/live.m3u8$/.exec(path);
    if (live) return new Response(manifest(live[1]!), { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
    const segment = /^\/(red|blue)\/segments\/(\d+)\.ts$/.exec(path);
    if (segment) { record.sequence = Number(segment[2]); return new Response(Bun.file(join(directory, `${segment[1]}-${record.sequence % 6}.ts`))); }
    return new Response("Unknown fixture", { status: 404 });
  } });
  origin = `http://127.0.0.1:${server.port}`;
  return { origin, definition: { name: "IPTV qualification", playlistUrl: `${origin}/channels.m3u?private=playlist`, guideUrl: `${origin}/guide.xml?private=guide` },
    hashes, currentSequence, requests: () => structuredClone(requests),
    set failed(value: boolean) { failed = value; },
    update() { revision++; }, replaceSlow() { slowReplacement = true; }, resetSlow() { slowReplacement = false; },
    releaseSlow() { for (const release of [...waiting]) release(); },
    async close() { for (const release of [...waiting]) release(); await server.stop(true); await rm(directory, { recursive: true, force: true }); },
  };
}
export type GuideFixture = Awaited<ReturnType<typeof createGuideFixture>>;
