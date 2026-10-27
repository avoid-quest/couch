import type { ClockFit } from "./line";
import type { AudioBatch, ProcessorMessage, Recycle } from "./types";

export interface AudioPort { postMessage(message: ProcessorMessage, transfer?: Transferable[]): void }
const capacity = 1024;

// The Worker owns allocations. The receiver returns each transferred buffer immediately.
export class AudioBatches {
  private pool = Array.from({ length: 8 }, () => new Float32Array(capacity * 2));
  private batch: Float32Array<ArrayBuffer> | null = null;
  private frames = 0;
  private position = 0;
  private first = true;
  capture: ClockFit | null = null;
  server: ClockFit | null = null;
  ready = false;
  private envelope: AudioBatch = { type: "audio", position: 0, frames: 0, data: null!, capture: null, server: null, ready: false };
  private transfer: Transferable[] = [null!];
  constructor(private port: AudioPort) {}
  recycle(message: Recycle) {
    if (message.data.length === capacity * 2 && this.pool.length < 16) this.pool.push(message.data);
  }
  reset() {
    this.frames = 0; this.first = true; this.capture = this.server = null; this.ready = false;
    this.port.postMessage({ type: "reset" });
  }
  flush() {
    if (!this.frames || !this.batch) return;
    Object.assign(this.envelope, { position: this.position, frames: this.frames, data: this.batch,
      capture: this.capture, server: this.server, ready: this.ready });
    this.transfer[0] = this.batch.buffer;
    // Clear before sending too, so a synchronous test port may immediately recycle it.
    this.batch = null; this.frames = 0; this.capture = this.server = null;
    this.port.postMessage(this.envelope, this.transfer);
    this.envelope.data = null!; this.envelope.capture = this.envelope.server = null; this.transfer[0] = null!;
  }
  write(position: number, frames: number, read: (frame: number, channel: number) => number) {
    for (let i = 0; i < frames;) {
      if (this.frames && position + i !== this.position + this.frames) this.flush();
      this.batch ??= this.pool.pop() ?? new Float32Array(capacity * 2);
      if (!this.frames) this.position = position + i;
      const count = Math.min(frames - i, capacity - this.frames);
      for (let j = 0; j < count; j++) {
        this.batch[(this.frames + j) * 2] = read(i + j, 0);
        this.batch[(this.frames + j) * 2 + 1] = read(i + j, 1);
      }
      i += count; this.frames += count;
      if (this.frames === capacity) this.flush();
    }
    if (this.first) { this.first = false; this.flush(); }
  }
}
