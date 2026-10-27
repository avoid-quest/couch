import { createSocket } from "node:dgram";
import { crc32 } from "node:zlib";
import type { LanNetwork } from "./lan-listener";

// IPv4 Binding discovery on Couch's selected LAN supplies address candidates
// without a microphone prompt or an Internet service. Browser candidate policies
// vary; authenticated TURN remains available when direct connectivity fails.
export async function serveLiveStun(network: LanNetwork, port: number) {
  const socket = createSocket("udp4");
  socket.on("message", (request, peer) => {
    if (request.length < 20 || request.length > 1024
      || request.readUInt16BE(0) !== 1 || request.readUInt32BE(4) !== 0x2112a442
      || request.readUInt16BE(2) !== request.length - 20 || request.length % 4) return;
    // This endpoint accepts only unauthenticated Binding discovery, not ICE
    // connectivity checks, authentication, TURN, or legacy STUN extensions.
    for (let offset = 20; offset < request.length;) {
      if (offset + 4 > request.length) return;
      const type = request.readUInt16BE(offset), length = request.readUInt16BE(offset + 2);
      const next = offset + 4 + Math.ceil(length / 4) * 4;
      if (next > request.length || type < 0x8000) return;
      if (type === 0x8028 && (length !== 4 || next !== request.length
        || request.readUInt32BE(offset + 4) !== ((crc32(request.subarray(0, offset)) ^ 0x5354554e) >>> 0))) return;
      offset = next;
    }
    const response = Buffer.alloc(40);
    response.writeUInt16BE(0x0101, 0);
    response.writeUInt16BE(20, 2);
    request.copy(response, 4, 4, 20);
    response.writeUInt16BE(0x0020, 20); // XOR-MAPPED-ADDRESS, RFC 8489 §14.2.
    response.writeUInt16BE(8, 22);
    response[25] = 1;
    response.writeUInt16BE(peer.port ^ 0x2112, 26);
    const address = peer.address.split(".").reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0);
    response.writeUInt32BE((address ^ 0x2112a442) >>> 0, 28);
    response.writeUInt16BE(0x8028, 32);
    response.writeUInt16BE(4, 34);
    response.writeUInt32BE((crc32(response.subarray(0, 32)) ^ 0x5354554e) >>> 0, 36);
    socket.send(response, peer.port, peer.address, () => {});
  });
  try {
    await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.bind(port, network.address, resolve); });
  } catch (error) { socket.close(); throw error; }
  socket.removeAllListeners("error");
  socket.on("error", error => console.error("Couch: live address discovery failed.", error));
  let stopping: Promise<void> | undefined;
  return { port: socket.address().port, stop: () => stopping ??= new Promise<void>(resolve => socket.close(() => resolve())) };
}
