import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as http from "node:http";
import * as https from "node:https";
import { certificate } from "../src/server/certificate";
import { serve } from "../src/server/http";
import { percentile, writeEvidence } from "./evidence";

// A shared HTTP/HTTPS listener must not add a delayed-ACK round trip to every
// small response. Linux exposed this as a repeatable ~44ms cost on the TV.
test("shared HTTP and HTTPS keep-alive responses retain plain HTTP latency", { skip: process.platform !== "linux" }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-http-latency-"));
  try {
    const tls = await certificate(directory, ["localhost", "127.0.0.1"]);
    const medians: number[] = [], measured: Record<string, object> = {};
    for (const mode of ["plain", "shared-http", "shared-https"]) {
      const server = await serve({
        hostname: "127.0.0.1", port: 0, ...(mode === "plain" ? {} : { tls }), maxRequestBodySize: 4096,
        fetch: async () => Response.json({ player: "idle" }),
        websocket: { maxPayload: 4096, open() {}, message() {}, close() {} },
      });
      const secure = mode === "shared-https";
      // Trust only this fixture's leaf, including Electron's BoringSSL runtime.
      const agent = secure ? new https.Agent({ keepAlive: true, ca: tls.cert, allowPartialTrustChain: true }) : new http.Agent({ keepAlive: true });
      try {
        const samples: number[] = [];
        for (let i = 0; i < 25; i++) {
          const started = performance.now();
          await new Promise<void>((resolve, reject) => {
            const request = (secure ? https : http).get(`${secure ? "https" : "http"}://127.0.0.1:${server.port}/`, { agent }, response => {
              let body = "";
              response.setEncoding("utf8");
              response.on("data", chunk => { body += chunk; });
              response.once("error", reject);
              response.once("end", () => {
                try { assert.equal(response.statusCode, 200); assert.deepEqual(JSON.parse(body), { player: "idle" }); resolve(); }
                catch (error) { reject(error); }
              });
            });
            request.setTimeout(5_000, () => request.destroy(new Error("Response timed out")));
            request.once("error", reject);
          });
          if (i >= 5) samples.push(performance.now() - started);
        }
        samples.sort((a, b) => a - b);
        medians.push(samples[Math.floor(samples.length / 2)]!);
        measured[mode] = { n: samples.length, medianMs: medians.at(-1), p95Ms: percentile(samples, 0.95), maxMs: samples.at(-1) };
        t.diagnostic(`${mode}: n=${samples.length}, median=${medians.at(-1)!.toFixed(3)}ms`);
      } finally { agent.destroy(); await server.stop(); }
    }
    await writeEvidence("http-latency", {
      input: "Node keep-alive requests to an in-process listener over loopback; 5 warm-up requests excluded",
      measured, untested: ["network between devices", "browser and app clients", "Core's real routes"],
    });
    for (const [index, name] of ["HTTP", "HTTPS"].entries()) {
      assert.ok(medians[index + 1]! < medians[0]! + 20, `${name} median ${medians[index + 1]}ms exceeds plain ${medians[0]}ms by a delayed-ACK interval`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
