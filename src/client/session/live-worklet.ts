import { LiveTimeline, type LiveMessage } from "./live-timeline";

// The Live player's audio thread (AudioWorkletGlobalScope), which TypeScript's DOM types don't cover.
declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, processor: new () => object): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

// Ten reports a second: the player samples once a second, and a report is never more than this late.
const reportFrames = sampleRate / 10;

registerProcessor(
  "couch-live",
  class extends AudioWorkletProcessor {
    private timeline = new LiveTimeline(sampleRate);
    private epoch = 0;
    private next = currentFrame;
    private reported = currentFrame;
    constructor() {
      super();
      this.port.onmessage = ({ data }: MessageEvent<LiveMessage>) => {
        if (data.type === "chunk") return this.timeline.push(data.chunk, this.next);
        this.timeline.reset();
        this.epoch = data.epoch;
      };
    }
    process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
      const output = outputs[0]!;
      this.timeline.render(currentFrame, output);
      this.next = currentFrame + (output[0]?.length ?? 0);
      if (this.next - this.reported >= reportFrames) {
        this.reported = this.next;
        this.port.postMessage({ epoch: this.epoch, stats: this.timeline.takeStats() });
      }
      return true;
    }
  },
);
