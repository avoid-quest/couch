import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { LibraryItem } from "../../src/shared/library";
import type { MusicContext } from "./music";

type Anchor = { referenceSample: number; captureSample: number; offset: number; correlation: number };
const blockSize = 64;

function correlation(reference: Int16Array, captured: Int16Array, r: number, c: number, count: number, stride = 1) {
  let dot = 0, referencePower = 0, capturePower = 0;
  for (let index = 0; index < count; index += stride) {
    const x = reference[r + index]!, y = captured[c + index]!;
    dot += x * y; referencePower += x * x; capturePower += y * y;
  }
  return dot / Math.sqrt(referencePower * capturePower) || 0;
}

function anchor(reference: Int16Array, captured: Int16Array, referenceSample: number): Anchor {
  const count = 512;
  let captureSample = -1, score = -1;
  for (let sample = 0; sample < captured.length - count; sample++) {
    const value = correlation(reference, captured, referenceSample, sample, count, 4);
    if (value > score) { score = value; captureSample = sample; }
  }
  return { referenceSample, captureSample, offset: captureSample - referenceSample, correlation: score };
}

// The reference is nonperiodic, so correlation identifies sample positions,
// unlike an RMS/silence check or a repeated sine tone. The bounds retain any
// unmatched edge samples rather than calling fades or resampling sample loss.
export function analyzeTransition(reference: Int16Array, captured: Int16Array, sampleRate: number, splitSample: number) {
  const anchors = [sampleRate / 2, splitSample - sampleRate / 2, splitSample + sampleRate / 2, reference.length - sampleRate / 2]
    .map(sample => anchor(reference, captured, Math.floor(sample)));
  for (const point of anchors) assert.ok(point.correlation > 0.97, `Captured audio identifies reference sample ${point.referenceSample}: ${point.correlation}`);
  const firstOffset = anchors[1]!.offset, secondOffset = anchors[2]!.offset;
  const drift = [anchors[1]!.offset - anchors[0]!.offset, anchors[3]!.offset - anchors[2]!.offset];
  assert.ok(drift.every(samples => Math.abs(samples) <= 2), `Within-track sample alignment remains stable: ${drift}`);
  let tail = splitSample - blockSize;
  while (tail > splitSample - sampleRate && correlation(reference, captured, tail, tail + firstOffset, blockSize) < 0.995) tail--;
  let head = splitSample;
  while (head < splitSample + sampleRate && correlation(reference, captured, head, head + secondOffset, blockSize) < 0.995) head++;
  assert.ok(tail > splitSample - sampleRate && head < splitSample + sampleRate, "Both recorded tracks match the reference near the transition");
  const lastConfirmedFirstSample = tail + blockSize;
  const firstConfirmedSecondSample = head;
  const captureStart = lastConfirmedFirstSample + firstOffset;
  const captureEnd = firstConfirmedSecondSample + secondOffset;
  let silent = 0, longestSilence = 0, run = 0;
  for (let index = captureStart; index < captureEnd; index++) {
    if (Math.abs(captured[index]!) <= 3) { silent++; longestSilence = Math.max(longestSilence, ++run); }
    else run = 0;
  }
  const missingUpperBound = splitSample - lastConfirmedFirstSample + firstConfirmedSecondSample - splitSample;
  const unmatchedCaptured = Math.max(0, captureEnd - captureStart - silent);
  // Check every interior window too. Endpoint anchors alone could conceal a
  // dropped region followed by a compensating repetition in the same track.
  const unmatchedInteriorWindows: { referenceSample: number; captureSample: number; samples: number; correlation: number }[] = [];
  for (const [start, end, offset] of [[0, lastConfirmedFirstSample, firstOffset], [firstConfirmedSecondSample, reference.length, secondOffset]]) {
    for (let sample = start!; sample < end!; sample += blockSize) {
      const count = Math.min(blockSize, end! - sample);
      const score = correlation(reference, captured, sample, sample + offset!, count);
      if (score < 0.995) unmatchedInteriorWindows.push({ referenceSample: sample, captureSample: sample + offset!, samples: count, correlation: score });
    }
  }
  const interiorUncertainty = unmatchedInteriorWindows.reduce((sum, window) => sum + window.samples, 0);
  // A correlation window can still match with a few changed edge samples.
  // Preserve one full window of uncertainty on each side of the join.
  const uncertainty = blockSize * 2 + interiorUncertainty;
  const netInsertedSamples = secondOffset - firstOffset;
  return {
    sampleRate, splitSample, anchors, withinTrackOffsetChangeSamples: drift,
    netInsertedSamples, netInsertedMilliseconds: netInsertedSamples / sampleRate * 1000,
    insertedSilenceSamples: silent, insertedSilenceMilliseconds: silent / sampleRate * 1000,
    longestSilenceSamples: longestSilence,
    unmatchedReferenceEdgeSamples: missingUpperBound, unmatchedCapturedEdgeSamples: unmatchedCaptured,
    boundaryUncertaintySamples: blockSize * 2, unmatchedInteriorWindows,
    missingSamplesBounds: [0, missingUpperBound + uncertainty], repeatedSamplesBounds: [0, unmatchedCaptured + uncertainty],
    boundary: { lastConfirmedFirstSample, firstConfirmedSecondSample, captureStart, captureEnd },
    method: "Nonperiodic lossless reference correlation at four anchors and every interior 64-sample window. Correlation >=0.995 locates boundary content; loss/repetition bounds retain 64 samples of uncertainty at each edge plus all unmatched interior windows. Samples within 3 of zero count as silence. These are conservative bounds, not proof of sample-perfect continuity. No physical-output or gapless qualification.",
  };
}

async function run(args: string[]) {
  const process = Bun.spawn(args, { stdout: "pipe", stderr: "inherit" });
  const [code, output] = await Promise.all([process.exited, new Response(process.stdout).arrayBuffer()]);
  assert.equal(code, 0, `${args[0]} completes`);
  return output;
}

export async function verifyMusicTransition(context: MusicContext, tracks: LibraryItem[], options: { artifactDir?: string; folder?: string; enqueue?: (ids: string[]) => Promise<void> } = {}) {
  const { clients, until } = context;
  const artifactDir = options.artifactDir ?? context.artifactDir;
  await mkdir(artifactDir, { recursive: true });
  const first = () => clients[0]!.state!;
  const all = (predicate: (state: NonNullable<typeof clients[number]["state"]>) => boolean) => clients.every(client => client.state && predicate(client.state));
  assert.equal(tracks.length, 2);
  const original = { volume: first().player.volume, preferences: structuredClone(first().preferences!), profileId: first().activeProfile.id };
  const manifest = await Bun.file("/transition-reference/manifest.json").json();
  const referenceBytes = await Bun.file("/transition-reference/continuous.s16le").arrayBuffer();
  const reference = new Int16Array(referenceBytes);
  const paths = [1, 2].map(part => `${options.folder ?? "/mnt/music-fixtures/transitions"}/part-${part}.flac`);
  const decodedParts = await Promise.all(paths.map(path => run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-f", "s16le", "-ar", String(manifest.sampleRate), "-ac", "1", "-"])));
  assert.deepEqual(Buffer.concat(decodedParts.map(part => Buffer.from(part))), Buffer.from(referenceBytes), "Concatenated decoded lossless fixtures equal the unsplit reference byte for byte");
  await Bun.write(`${artifactDir}/music-fixtures.json`, JSON.stringify(manifest, null, 2));
  await Bun.write(`${artifactDir}/music-reference.wav`, Bun.file("/transition-reference/continuous.wav"));
  await Bun.write(`${artifactDir}/music-pulse-sinks.json`, await run(["pactl", "--format=json", "list", "sinks"]));
  const capturePath = `${artifactDir}/music-native-transition.wav`;
  const capture = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "info", "-y", "-f", "pulse", "-sample_rate", String(manifest.sampleRate), "-channels", "2", "-i", "couch.monitor", "-t", "16", "-ac", "1", "-c:a", "pcm_s16le", capturePath], {
    stdout: "ignore", stderr: Bun.file(`${artifactDir}/music-audio-capture.log`),
  });
  const playbackIds: string[] = [];
  try {
    await until("PulseAudio monitor recording starts before native music playback", async () => await Bun.file(capturePath).exists() && Bun.file(capturePath).size > 44);
    await clients[0]!.command({ type: "volume", volume: 100 });
    await clients[0]!.command({ type: "preferences", profileId: original.profileId, preferences: { ...original.preferences.profile, speed: 1 } });
    const ids = tracks.map(() => crypto.randomUUID());
    if (options.enqueue) await options.enqueue(ids);
    else for (const [index, track] of tracks.entries()) await clients[1]!.command({ type: "enqueueLibrary", itemId: track.id, entryId: ids[index]! });
    // Set the device delay before the measured load; settings require a live ID.
    await clients[0]!.command({ type: "play", entryId: ids[0]!, fromStart: true });
    await until("first lossless sample starts through native libmpv", () => all(state => state.player.status === "playing" && state.currentEntryId === ids[0]));
    await clients[0]!.command({ type: "audioDelay", playbackId: first().player.playbackId!, delay: 0 });
    await clients[0]!.command({ type: "stop" });
    await until("native preflight load stops before the measured sequence", () => all(state => state.player.status === "idle"));
    // The recording's preflight audio is deliberately excluded by restarting it.
    capture.kill("SIGINT");
    await capture.exited;
    const measured = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "info", "-y", "-f", "pulse", "-sample_rate", String(manifest.sampleRate), "-channels", "2", "-i", "couch.monitor", "-t", "12", "-ac", "1", "-c:a", "pcm_s16le", capturePath], { stdout: "ignore", stderr: Bun.file(`${artifactDir}/music-audio-capture.log`) });
    try {
      await until("fresh monitor recording is ready for the measured queue transition", async () => (await Bun.file(`${artifactDir}/music-audio-capture.log`).text()).includes("Output #0"));
      await Bun.sleep(300);
      await clients[0]!.command({ type: "play", entryId: ids[0]!, fromStart: true });
      await until("measured first lossless track plays on both controllers", () => all(state => state.player.status === "playing" && state.currentEntryId === ids[0] && state.player.position > 0));
      playbackIds.push(first().player.playbackId!);
      await until("natural EOF advances the queue into the second native lossless track", () => all(state => state.player.status === "playing" && state.currentEntryId === ids[1] && state.player.position > 0), 10_000);
      playbackIds.push(first().player.playbackId!);
      await until("second lossless track reaches its actual native EOF", () => all(state => state.player.status === "ended" && state.currentEntryId === ids[1]), 10_000);
      assert.equal(await measured.exited, 0, "Native PulseAudio capture completes");
    } finally {
      if (measured.exitCode === null) { measured.kill("SIGINT"); await measured.exited; }
    }
    const capturedBytes = await run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", capturePath, "-f", "s16le", "-ar", String(manifest.sampleRate), "-ac", "1", "-"]);
    const result = analyzeTransition(reference, new Int16Array(capturedBytes), manifest.sampleRate, manifest.splitSample);
    await Bun.write(`${artifactDir}/music-audio-transition.json`, JSON.stringify({ observedAt: new Date().toISOString(), playbackIds, fixture: manifest, captureSha256: createHash("sha256").update(Buffer.from(await Bun.file(capturePath).arrayBuffer())).digest("hex"), ...result }, null, 2));
    await run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", capturePath, "-filter_complex", "showwavespic=s=1600x360:colors=32b8d9", "-frames:v", "1", `${artifactDir}/music-audio-waveform.png`]);
    console.log(`PASS native music transition measured: ${result.netInsertedMilliseconds.toFixed(3)} ms net insertion, ${result.insertedSilenceMilliseconds.toFixed(3)} ms silence, missing samples ${result.missingSamplesBounds.join("..")}, repeated samples ${result.repeatedSamplesBounds.join("..")}`);
    return result;
  } finally {
    if (capture.exitCode === null) { capture.kill("SIGINT"); await capture.exited; }
    if (first().player.playbackId && first().player.status !== "idle") await clients[0]!.command({ type: "audioDelay", playbackId: first().player.playbackId!, delay: original.preferences.device.audioDelay });
    await clients[0]!.command({ type: "stop" });
    await clients[0]!.command({ type: "volume", volume: original.volume });
    await clients[0]!.command({ type: "preferences", profileId: original.profileId, preferences: original.preferences.profile });
    await until("music measurement restores saved profile and TV playback preferences", () => all(state => state.player.status === "idle" && state.player.volume === original.volume && JSON.stringify(state.preferences) === JSON.stringify(original.preferences)));
  }
}
