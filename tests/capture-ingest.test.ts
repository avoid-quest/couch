import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import type { WebSocket } from "ws";
import { acceptCaptureUpload } from "../src/server/capture-ingest";

test("capture failure ignores buffered messages and reports the failure only once", () => {
  const sent: string[] = [];
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send(message: string) { sent.push(message); }, close() { socket.readyState = 2; } });
  const failures: string[] = [];
  let writes = 0;
  acceptCaptureUpload(socket as unknown as WebSocket, () => { writes++; return true; }, error => failures.push(error));
  try {
    socket.emit("message", Buffer.from("invalid"), false);
    socket.emit("message", Buffer.from("invalid again"), false);
    socket.emit("message", Buffer.from(JSON.stringify({ type: "start", generation: "late", offsetUs: 0, rttUs: 1 })), false);
    socket.emit("message", Buffer.from(JSON.stringify({ type: "clock", clientUs: 0 })), false);
    const packet = Buffer.alloc(44);
    packet.writeUInt32LE(0x31414343, 0); packet.writeUInt8(1, 4); packet.writeUInt8(1, 5);
    packet.writeUInt16LE(40, 6); packet.writeUInt32LE(48_000, 8); packet.writeUInt32LE(1, 32);
    packet.writeBigInt64LE(BigInt(serverNowUs()), 24);
    socket.emit("message", packet, true);
    expect(failures).toHaveLength(1);
    expect(writes).toBe(0);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).type).toBe("error");
  } finally { socket.emit("close"); }
});
