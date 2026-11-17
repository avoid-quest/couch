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
    // The feed's port (live-feed.ts): chunks come from its Worker and reports go back to it, past the
    // page's main thread, which only hands the port over.
    private feed: MessagePort | undefined;
    constructor() {
      super();
      this.port.onmessage = ({ data }: MessageEvent<{ port: MessagePort }>) => {
        this.feed = data.port;
        this.feed.onmessage = ({ data }: MessageEvent<LiveMessage>) => {
          if (data.type === "chunk") return this.timeline.push(data.chunk, this.next);
          this.timeline.reset();
          this.epoch = data.epoch;
        };
      };
    }
    process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
      const output = outputs[0]!;
      this.timeline.render(currentFrame, output);
      this.next = currentFrame + (output[0]?.length ?? 0);
      if (this.next - this.reported >= reportFrames) {
        this.reported = this.next;
        this.feed?.postMessage({ epoch: this.epoch, stats: this.timeline.takeStats() });
      }
      return true;
    }
  },
);
