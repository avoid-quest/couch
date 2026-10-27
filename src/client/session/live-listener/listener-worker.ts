import { ListenerNetwork } from "./network";
import type { Recycle, WorkerCommand, WorkerEvent } from "./types";

// Avoid adding WebWorker globals to the DOM compilation used by the rest of the client.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerCommand>) => void;
  postMessage(message: WorkerEvent): void;
};
let network: ListenerNetwork | undefined;
scope.onmessage = ({ data }) => {
  if (data.type === "stats") { network?.stats(data.stats); return; }
  network?.stop();
  network = new ListenerNetwork(data, data.port, event => scope.postMessage(event));
  const current = network;
  data.port.onmessage = ({ data }: MessageEvent<Recycle>) => {
    if (data.type === "recycle") current.batches.recycle(data);
  };
  network.start();
};
