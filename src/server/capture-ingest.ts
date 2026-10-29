import type { WebSocket, RawData } from "ws";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import { decodeCapturePacket, type CaptureAudioPacket } from "./capture-audio";

/** Runs after Core authenticates origin, publication, owner and upload token. */
export function acceptCaptureUpload(socket: WebSocket, write: (packet: CaptureAudioPacket) => boolean, failed: (error: string) => void) {
  let generation: string | undefined, offset: number | undefined, pings = 0, bytes = 0, windowAt = serverNowUs();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const fail = (error: string) => { if (stopped) return; stopped = true; clearTimeout(timer); failed(error); if (socket.readyState === 1) { socket.send(JSON.stringify({ type: "error", error })); socket.close(1008, error.slice(0, 120)); } };
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => fail("The timestamped capture stopped sending audio."), 5000); };
  arm(); socket.once("close", () => { stopped = true; clearTimeout(timer); });
  socket.on("message", (data: RawData, binary: boolean) => {
    if (stopped) return;
    try {
      const now = serverNowUs();
      if (now - windowAt > 1e6) { windowAt = now; bytes = 0; pings = 0; }
      const buffer = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.concat(data);
      bytes += buffer.length;
      if (bytes > 1_600_000) throw new Error("The capture exceeded its upload rate limit.");
      if (!binary) {
        if (buffer.length > 1024 || ++pings > 16) throw new Error("Invalid capture clock exchange.");
        const message = JSON.parse(buffer.toString());
        if (message.type === "clock" && Number.isSafeInteger(message.clientUs)) {
          socket.send(JSON.stringify({ type: "clock", clientUs: message.clientUs, serverUs: now })); return;
        }
        if (message.type !== "start" || generation || !/^[\w-]{1,64}$/.test(message.generation) || !Number.isSafeInteger(message.offsetUs) || !Number.isFinite(message.rttUs) || message.rttUs < 0 || message.rttUs > 100_000) throw new Error("The capture clock could not be synchronized.");
        generation = message.generation; offset = message.offsetUs; arm(); return;
      }
      if (!generation || offset === undefined) throw new Error("Synchronize the capture clock before sending audio.");
      const packet = decodeCapturePacket(buffer, generation, offset);
      if (packet.capturedAtUs > now + 50_000 || packet.capturedAtUs < now - 2_000_000) throw new Error("The capture timestamp is outside the upload window.");
      if (!write(packet)) throw new Error("This timestamped source is no longer available.");
      arm();
    } catch (reason) { fail(reason instanceof Error ? reason.message : "Invalid timestamped capture."); }
  });
}
