import { strict as assert } from "node:assert";

type Execute = (script: string, args?: unknown[]) => Promise<unknown>;

async function capturePixels(path: string) {
  const capture = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab",
    "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", path,
  ], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await capture.exited, 0, "native X11 pixel capture succeeds");
  const decode = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { stdout: "pipe", stderr: "inherit" });
  const pixels = new Uint8Array(await new Response(decode.stdout).arrayBuffer());
  assert.equal(await decode.exited, 0, "native X11 pixel capture decodes");
  return pixels;
}

// Sample the upper video region, away from subtitles and fullscreen controls.
// A marker maps CSS coordinates to the actual X11 pixels, including decorations.
export async function assertNativeVideoPixels(execute: Execute, artifactDir: string, name: string, expectedColor?: readonly [number, number, number]) {
  await execute(`
    const marker = document.createElement('div');
    marker.id = 'native-video-origin';
    Object.assign(marker.style, {
      position: 'fixed', left: '8px', top: '8px', width: '8px', height: '8px',
      background: 'rgb(13,217,101)', zIndex: '100000', pointerEvents: 'none',
    });
    document.body.append(marker);
    document.querySelectorAll('.pairing-display, .pair-shortcut strong').forEach(pairing => pairing.style.visibility = 'hidden');
  `);
  try {
    // Native fullscreen and WebKit viewport resize arrive separately. Use the
    // settled geometry corresponding to the captured pixels, not an intermediate size.
    let previous = "";
    let stableSince = Date.now();
    const deadline = Date.now() + 5_000;
    let stage!: { x: number; y: number; width: number; height: number };
    while (Date.now() < deadline) {
      stage = await execute(`const rect = document.querySelector('.video-stage').getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }`) as typeof stage;
      const current = JSON.stringify(stage);
      if (current !== previous) { previous = current; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= 350) break;
      await Bun.sleep(100);
    }
    assert.ok(Date.now() < deadline, `${name}: native video layout settles`);
    const pixels = await capturePixels(`${artifactDir}/${name}.png`);
    let origin = -1;
    for (let offset = 0; offset < pixels.length; offset += 3) {
      if (pixels[offset] === 13 && pixels[offset + 1] === 217 && pixels[offset + 2] === 101) { origin = offset / 3; break; }
    }
    assert.ok(origin >= 0, `${name}: WebView paints the current viewport marker`);
    const scale = Math.min(stage.width / 640, stage.height / 360);
    const videoWidth = 640 * scale;
    const videoHeight = 360 * scale;
    const left = Math.round(origin % 1600 - 8 + stage.x + (stage.width - videoWidth) / 2 + videoWidth * 0.1);
    const top = Math.round(Math.floor(origin / 1600) - 8 + stage.y + (stage.height - videoHeight) / 2 + videoHeight * 0.15);
    const width = Math.round(videoWidth * 0.8);
    const height = Math.round(videoHeight * 0.25);
    assert.ok(width > 0 && height > 0 && left >= 0 && top >= 0 && left + width <= 1600 && top + height <= 1000, `${name}: video sample lies inside the displayed window`);
    let colorful = 0;
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
      const offset = (y * 1600 + x) * 3;
      const maximum = Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
      const minimum = Math.min(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
      if (expectedColor ? expectedColor.every((channel, index) => Math.abs(pixels[offset + index]! - channel) <= 12) : maximum > 180 && maximum - minimum > 120) colorful++;
    }
    assert.ok(colorful >= width * height * (expectedColor ? 0.98 : 0.9), `${name}: native ${expectedColor ? `RGB ${expectedColor.join(",")}` : "pattern"} fills the video sample (${colorful}/${width * height} matching pixels)`);
  } finally {
    await execute("document.getElementById('native-video-origin')?.remove()");
  }
}

// DOM assertions still pass when WebKit's legacy X11 renderer loses its backing
// surface after the native video overlay is created. Check the displayed pixels.
export async function assertNativeUiPixels(execute: Execute, artifactDir: string) {
  await execute(`
    const marker = document.createElement('div');
    marker.id = 'native-pixel-probe';
    Object.assign(marker.style, {
      position: 'fixed', left: '8px', top: '8px', width: '80px', height: '24px',
      background: 'rgb(13,217,101)', zIndex: '100000', pointerEvents: 'none',
    });
    document.body.append(marker);
    document.querySelectorAll('.pairing-display, .pair-shortcut strong').forEach(pairing => pairing.style.visibility = 'hidden');
  `);
  try {
    await Bun.sleep(250);
    const pixels = await capturePixels(`${artifactDir}/native-ui-pixels.png`);
    let matches = 0;
    for (let offset = 0; offset < pixels.length; offset += 3) {
      if (Math.abs(pixels[offset]! - 13) <= 1 && Math.abs(pixels[offset + 1]! - 217) <= 1 && Math.abs(pixels[offset + 2]! - 101) <= 1) matches++;
    }
    assert.ok(matches >= 1_800, `WebView marker is visible over native playback (${matches}/1920 pixels)`);
  } finally {
    await execute("document.getElementById('native-pixel-probe')?.remove()");
  }
}
