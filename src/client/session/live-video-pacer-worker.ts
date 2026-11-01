// Present decoded frames in order at display cadence. Keep at most three waiting
// frames, as Moonlight's pacer does; no pixel copy, retimestamping or duplicate frames.
const scope = self;
const queue: VideoFrame[] = [];
let received = 0, pushed = 0, dropped = 0, frame = 0, stopped = false, writing = false;
let reader: ReadableStreamDefaultReader<VideoFrame>, writer: WritableStreamDefaultWriter<VideoFrame>;
const fail = (reason: unknown) => { if (!stopped) scope.postMessage({ error: String(reason) }); stopped = true; };
scope.onmessage = async event => {
  if (event.data.snapshot !== undefined) {
    scope.postMessage({ snapshot: event.data.snapshot, received, pushed, dropped, queued: queue.length });
    return;
  }
  if (event.data.stop) {
    stopped = true; scope.cancelAnimationFrame(frame);
    for (const value of queue.splice(0)) value.close();
    await reader?.cancel().catch(() => {}); await writer?.close().catch(() => {});
    scope.postMessage({ stopped: true });
    return;
  }
  try {
    reader = (event.data.readable as ReadableStream<VideoFrame>).getReader();
    writer = (event.data.writable as WritableStream<VideoFrame>).getWriter();
    const pump = () => {
      if (stopped) return;
      frame = scope.requestAnimationFrame(pump);
      if (writing || !queue.length) return;
      writing = true;
      const value = queue.shift()!;
      void writer.write(value).then(() => { pushed++; }, fail).finally(() => { value.close(); writing = false; });
    };
    frame = scope.requestAnimationFrame(pump);
    scope.postMessage({ ready: true });
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) { fail("The incoming video track ended"); break; }
      if (stopped) { value.close(); break; }
      received++;
      if (queue.length >= 3) { queue.shift()!.close(); dropped++; }
      queue.push(value);
    }
  } catch (error) { fail(error); }
};
export {};
