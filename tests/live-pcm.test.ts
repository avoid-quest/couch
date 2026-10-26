import { test, expect } from "bun:test";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import { createLivePcm } from "../src/server/live-pcm";

type Event = Parameters<Parameters<typeof createLivePcm>[0]>[0];

test("PCM sends partial packets immediately with bounded sizes, stereo clipping and sample timestamps", () => {
  const events: Event[] = [], errors: string[] = [];
  const source = createLivePcm(event => events.push(event), error => errors.push(error));
  try {
    const atUs = serverNowUs() + 1_000_000;
    const pcm = Float32Array.from({ length: 1001 * 2 }, (_, i) => i % 2 ? -2 : 2);
    expect(source.write({ reset: true, atUs, pcm })).toBe(true);
    expect(events[0]).toEqual({ type: "reset" });
    expect(events.filter(event => event.type === "chunk").length).toBeGreaterThan(0);
    const chunks = events.filter(event => event.type === "chunk");
    let frames = 0;
    for (const chunk of chunks) {
      expect(chunk.wire).toBe("pcm");
      expect(chunk.at).toBe(atUs + Math.round(frames / 48000 * 1e6));
      expect(chunk.data.length).toBeLessThanOrEqual(240 * 4);
      expect(chunk.duration).toBe(chunk.data.length / 4 / 48000 * 1e6);
      for (let offset = 0; offset < chunk.data.length; offset += 4) {
        expect(chunk.data.readInt16LE(offset)).toBe(32767);
        expect(chunk.data.readInt16LE(offset + 2)).toBe(-32768);
      }
      frames += chunk.data.length / 4;
    }
    expect(frames).toBe(1001);
    expect(chunks.at(-1)!.data.length).toBe(41 * 4);
    expect(errors).toEqual([]);
  } finally { source.close(); }
});

for (const action of ["reset", "close"] as const) test(`PCM ${action} cancels an already queued continuation`, async () => {
  const events: Event[] = [], errors: string[] = [];
  const atUs = serverNowUs() + 1_000_000;
  let enqueued = false;
  const source = createLivePcm(event => {
    events.push(event);
    if (event.type === "chunk" && !enqueued) {
      enqueued = true;
      source.write({ reset: false, atUs: atUs + 100_000, pcm: new Float32Array(4096 * 2).fill(.25) });
    }
  }, error => errors.push(error));
  try {
    source.write({ reset: true, atUs, pcm: new Float32Array(4096 * 2).fill(.25) });
    const before = events.length;
    expect(before).toBeLessThan(23);
    if (action === "close") source.close();
    else source.write({ reset: true, atUs: atUs + 1_000_000, pcm: new Float32Array([-.5, .5]) });
    await Promise.resolve();
    if (action === "close") {
      expect(events.length).toBe(before);
      expect(source.write({ reset: true, atUs, pcm: new Float32Array(2) })).toBe(false);
    } else {
      expect(events.slice(before)).toEqual([{ type: "reset" }, { type: "chunk", wire: "pcm", at: atUs + 1_000_000,
        duration: 1 / 48000 * 1e6, data: Buffer.from([0, 192, 0, 64]) }]);
    }
    expect(errors).toEqual([]);
  } finally { source.close(); }
});

test("reentrant reset during fanout discards the previous block", () => {
  const events: Event[] = [], errors: string[] = [];
  const atUs = serverNowUs() + 1_000_000;
  const source = createLivePcm(event => {
    events.push(event);
    if (event.type === "chunk" && event.at === atUs) source.write({ reset: true, atUs: atUs + 1_000_000, pcm: new Float32Array([.5, -.5]) });
  }, error => errors.push(error));
  try {
    source.write({ reset: true, atUs, pcm: new Float32Array(1000) });
    expect(events.map(event => event.type)).toEqual(["reset", "chunk", "reset", "chunk"]);
    expect(errors).toEqual([]);
  } finally { source.close(); }
});

test("PCM backlog fails once at two seconds and cancels its continuation", async () => {
  const events: Event[] = [], errors: string[] = [];
  const atUs = serverNowUs() + 1_000_000;
  let enqueued = false;
  const source = createLivePcm(event => {
    events.push(event);
    if (event.type === "chunk" && !enqueued) {
      enqueued = true;
      for (let index = 0; index < 24; index++) source.write({ reset: false, atUs: atUs + (index + 1) * 100_000, pcm: new Float32Array(4096 * 2) });
    }
  }, error => errors.push(error));
  try {
    expect(source.write({ reset: true, atUs, pcm: new Float32Array(4096 * 2) })).toBe(false);
    const before = events.length;
    await Promise.resolve();
    expect(events.length).toBe(before);
    expect(errors).toEqual(["PCM capture exceeded its bounded queue."]);
    expect(source.write({ reset: true, atUs, pcm: new Float32Array(2) })).toBe(false);
    expect(errors.length).toBe(1);
  } finally { source.close(); }
});

test("overdue PCM keeps fixed deadlines and fails once after half a second", () => {
  const events: Event[] = [], errors: string[] = [];
  const source = createLivePcm(event => events.push(event), error => errors.push(error));
  try {
    for (let index = 0; index < 24; index++) expect(source.write({ reset: index === 0, atUs: -1_000_000, pcm: new Float32Array(960 * 2) })).toBe(true);
    expect(source.write({ reset: false, atUs: -1_000_000, pcm: new Float32Array(960 * 2) })).toBe(false);
    expect(events).toEqual([{ type: "reset" }]);
    expect(errors).toEqual(["PCM capture missed half a second of deadlines. Start sharing again."]);
  } finally { source.close(); }
});
