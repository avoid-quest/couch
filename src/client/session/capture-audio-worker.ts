// Upload clock exchange and sample serialization run off the UI thread.
// AudioData carries an explicit source-realm performance.timeOrigin across this seam.
type Frame = { timestamp: number; sampleRate: number; numberOfChannels: number; numberOfFrames: number; copyTo(destination: Float32Array, options: { planeIndex: number; format: string }): void; close(): void };
let socket: WebSocket | undefined, stopped = false;
let sequence = 0, position = 0, lastTimestamp: number | undefined, lastFrames = 0, rate = 0, channels = 0;
const fail = (reason: unknown) => { if (!stopped) postMessage({ error: reason instanceof Error ? reason.message : "Timestamped audio capture failed." }); stopped = true; socket?.close(); };
self.onmessage = async event => {
  if (event.data.frame) {
    const frame = event.data.frame as Frame;
    try {
      if (stopped || socket?.readyState !== WebSocket.OPEN) return;
      const connection = socket;
      const timestamp = frame.timestamp + (event.data.timeOrigin - performance.timeOrigin) * 1000;
      const ageUs = performance.now() * 1000 - timestamp;
      if (!Number.isFinite(ageUs) || ageUs < -50_000 || ageUs > 2_000_000) throw new Error("Capture timestamps do not use this browser's monotonic clock.");
      if (!rate) { rate = frame.sampleRate; channels = frame.numberOfChannels; }
      if (frame.sampleRate !== rate || frame.numberOfChannels !== channels) throw new Error("The capture format changed. Start sharing again.");
      if (lastTimestamp !== undefined) {
        const gap = Math.round((timestamp - lastTimestamp) * rate / 1e6) - lastFrames;
        if (gap < -Math.ceil(rate * .002) || gap > rate * .04) throw new Error("The audio input's capture clock was interrupted.");
        if (gap > Math.ceil(rate * .002)) position += gap; // Dropped processor frames keep their missing sample positions.
      }
      lastTimestamp = timestamp; lastFrames = frame.numberOfFrames;
      const planes = Array.from({ length: channels }, (_, channel) => { const data = new Float32Array(frame.numberOfFrames); frame.copyTo(data, { planeIndex: channel, format: "f32-planar" }); return data; });
      for (let start = 0; start < frame.numberOfFrames; start += 4096) {
        const frames = Math.min(4096, frame.numberOfFrames - start), buffer = new ArrayBuffer(40 + frames * channels * 4), view = new DataView(buffer);
        view.setUint32(0, 0x31414343, true); view.setUint8(4, channels); view.setUint8(5, 1); view.setUint16(6, 40, true); view.setUint32(8, rate, true); view.setUint32(12, sequence++, true); view.setBigUint64(16, BigInt(position), true); view.setBigInt64(24, BigInt(Math.round(timestamp + start / rate * 1e6)), true); view.setUint32(32, frames, true);
        const pcm = new Float32Array(buffer, 40);
        for (let f = 0; f < frames; f++) for (let ch = 0; ch < channels; ch++) pcm[f * channels + ch] = planes[ch]![start + f]!;
        if (connection.bufferedAmount + buffer.byteLength > 192_000) throw new Error("The connection cannot keep up with audio capture.");
        connection.send(buffer); position += frames;
      }
      postMessage({ consumed: true });
    } catch (error) { fail(error); }
    finally { frame.close(); }
    return;
  }
  try {
    socket = new WebSocket(event.data.url);
    const connection = socket;
    await new Promise<void>((resolve, reject) => { connection.onopen = () => resolve(); connection.onerror = () => reject(new Error("The capture upload could not connect.")); });
    let best = { rttUs: Infinity, offsetUs: 0 };
    for (let i = 0; i < 5; i++) {
      const clientUs = Math.round(performance.now() * 1000);
      const sample = await new Promise<{ serverUs: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The capture clock exchange timed out.")), 2000);
        connection.onmessage = event => { try { const reply = JSON.parse(event.data); if (reply.type === "error") throw new Error(reply.error); if (reply.type !== "clock" || reply.clientUs !== clientUs) return; clearTimeout(timer); resolve(reply); } catch (error) { clearTimeout(timer); reject(error); } };
        connection.send(JSON.stringify({ type: "clock", clientUs }));
      });
      const now = Math.round(performance.now() * 1000), rttUs = now - clientUs;
      if (rttUs < best.rttUs) best = { rttUs, offsetUs: Math.round(sample.serverUs - (now + clientUs) / 2) };
    }
    if (best.rttUs > 100_000) throw new Error("The capture connection is too slow to synchronize.");
    connection.send(JSON.stringify({ type: "start", generation: crypto.randomUUID(), ...best }));
    connection.onmessage = event => { try { const message = JSON.parse(event.data); if (message.type === "error") fail(new Error(message.error)); } catch (error) { fail(error); } };
    connection.onerror = () => fail(new Error("The capture upload disconnected."));
    connection.onclose = () => fail(new Error("Couch stopped the capture upload."));
    postMessage({ ready: true });
  } catch (error) { fail(error); }
};
export {};
