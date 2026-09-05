import { strict as assert } from "node:assert";

const target = new URL(process.argv[2] ?? "http://127.0.0.1:6080");
assert.equal(target.protocol, "http:");

async function upgrade(origin?: string, path = "/websockify", host = target.host): Promise<number> {
  return new Promise(async (resolve, reject) => {
    let response = "";
    const timer = setTimeout(() => reject(new Error("Preview WebSocket handshake timed out")), 3000);
    try {
      const socket = await Bun.connect({
        hostname: target.hostname, port: Number(target.port || 80),
        socket: {
          open(socket) {
            socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${origin === undefined ? "" : `Origin: ${origin}\r\n`}\r\n`);
          },
          data(socket, data) {
            response += new TextDecoder().decode(data);
            const status = Number(response.split(" ")[1]);
            if (!response.includes("\r\n\r\n") || status === 101 && !response.includes("RFB 003.")) return;
            clearTimeout(timer);
            resolve(status);
            socket.end();
          },
          error(_socket, error) { clearTimeout(timer); reject(error); },
          close() { clearTimeout(timer); reject(new Error(`Preview closed before completing its handshake: ${response.slice(0, 80)}`)); },
        },
      });
      setTimeout(() => socket.end(), 3000).unref();
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}

assert.equal((await fetch(new URL("/vnc.html", target))).status, 200, "noVNC navigation must work without an Origin header");
for (const origin of ["http://127.0.0.1:6080", "http://localhost:6080"]) {
  assert.equal(await upgrade(origin), 101, `${origin} must reach the VNC server`);
  console.log(`PASS legitimate VNC handshake: ${origin}`);
}
for (const origin of ["https://untrusted.example", undefined, "null", "http://127.0.0.1:4100", "http://127.0.0.1.evil.example:6080"]) {
  assert.equal(await upgrade(origin), 403, `${origin ?? "missing Origin"} must be rejected`);
  console.log(`PASS rejected: ${origin ?? "missing Origin"}`);
}
assert.equal(await upgrade("https://untrusted.example", "/"), 403, "alternate upgrade paths must enforce the origin check");
assert.equal(await upgrade("http://untrusted.example:6080", "/websockify", "untrusted.example:6080"), 403, "a rebound Host must not authorize its Origin");
console.log("PASS alternate path and rebound Host rejected; no desktop input sent");
