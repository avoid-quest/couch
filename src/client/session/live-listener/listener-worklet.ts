import { LiveProcessor } from "./processor";
import type { Calibration, ProcessorMessage } from "./types";

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof LiveWorklet): void;

class LiveWorklet extends AudioWorkletProcessor {
  private audioPort: MessagePort | undefined;
  private readonly renderer: LiveProcessor;
  constructor({ processorOptions }: { processorOptions: { calibration: Calibration } }) {
    super();
    this.renderer = new LiveProcessor(sampleRate, processorOptions.calibration, {
      report: stats => this.port.postMessage(stats),
      recycle: (message, transfer) => this.audioPort?.postMessage(message, transfer),
    });
    this.port.onmessage = ({ data }: MessageEvent<ProcessorMessage | { type: "port"; port: MessagePort }>) => {
      if (data.type === "port") {
        this.audioPort = data.port;
        data.port.onmessage = ({ data }: MessageEvent<ProcessorMessage>) => this.receive(data);
      } else this.receive(data);
    };
  }
  private receive(message: ProcessorMessage) {
    this.renderer.frame = currentFrame;
    this.renderer.message(message);
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0];
    if (output?.[0] && output[1]) this.renderer.process(output[0], output[1], currentFrame);
    return true;
  }
}
registerProcessor("couch-live", LiveWorklet);
