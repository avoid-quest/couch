import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { decodeClock, type ClockCapture } from "./iptv-clock";
import type { UiDriver } from "./ui";

export async function captureGuideClock(ui: UiDriver, artifactDir: string, name: string, epoch: number): Promise<ClockCapture & { sha256: string }> {
  await ui.watching();
  const geometry = () => ui.execute(`
    const rect = document.querySelector('.video-stage').getBoundingClientRect();
    return { viewport: [innerWidth, innerHeight, devicePixelRatio], stage: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  `) as Promise<{ viewport: number[]; stage: { x: number; y: number; width: number; height: number } }>;
  const before = await geometry();
  assert.deepEqual(before.viewport, [1600, 1000, 1], "Native clock qualification uses the strict 1600x1000 viewport");
  await ui.execute(`
    const marker = document.createElement('div'); marker.id = 'iptv-capture-origin';
    Object.assign(marker.style, { position: 'fixed', left: '8px', top: '8px', width: '8px', height: '8px', background: 'rgb(13,217,101)', zIndex: '100000' });
    document.body.append(marker);
    document.querySelectorAll('.pairing-display, .pair-shortcut strong').forEach(node => node.style.visibility = 'hidden');
  `);
  try {
    await Bun.sleep(100);
    const path = `${artifactDir}/${name}.png`, captureStart = Date.now(), monotonicStart = performance.now();
    const capture = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", path], { stdout: "ignore", stderr: "inherit" });
    assert.equal(await capture.exited, 0, "Native clock X11 capture succeeds");
    const captureEnd = Date.now();
    assert.ok(Math.abs(captureEnd - captureStart - (performance.now() - monotonicStart)) < 100, "Capture wall clock agrees with monotonic elapsed time");
    assert.deepEqual(await geometry(), before, "Native video geometry stays fixed throughout clock capture");
    const decode = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdout: "pipe", stderr: "inherit" });
    const pixels = new Uint8Array(await new Response(decode.stdout).arrayBuffer());
    assert.equal(await decode.exited, 0, "Native clock screenshot decodes");
    assert.equal(pixels.length, 1600 * 1000 * 3, "X11 capture is exactly 1600x1000 RGB24");
    // This HTML mark only verifies screen origin; it contains no clock data.
    const origin = (8 * 1600 + 8) * 3;
    assert.deepEqual([...pixels.subarray(origin, origin + 3)], [13, 217, 101], "Fullscreen WebView origin aligns with the X11 capture");
    const stage = before.stage, scale = Math.min(stage.width / 640, stage.height / 360);
    const video = { left: stage.x + (stage.width - 640 * scale) / 2, top: stage.y + (stage.height - 360 * scale) / 2, width: 640 * scale, height: 360 * scale };
    const tick = decodeClock(pixels, 1600, 1000, video);
    return { tick, epoch, captureStart, captureEnd, sha256: createHash("sha256").update(await Bun.file(path).bytes()).digest("hex") };
  } finally { await ui.execute("document.querySelector('#iptv-capture-origin')?.remove()"); }
}
