import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Exercise the actual upgrade guard with an injected parser failure, without
// sending malformed requests or opening a listener.
const source = readFileSync(new URL("./audio-lab/ingress-server.ts", import.meta.url), "utf8");
const guard = source.match(/server.on\("upgrade", \(request, socket, head\) => \{([\s\S]*?)    ws.handleUpgrade/)?.[1];
assert(guard, "Use the actual ingress upgrade guard");

for (const throws of [false, true]) test(`upgrade guard ${throws ? "contains parser failures" : "allows the configured endpoint"}`, () => {
  const responses: string[] = [];
  const code = stripTypeScriptTypes(`function check() { ${guard} return "accepted"; } check();`);
  const result = runInNewContext(code, {
    URL: throws ? class { constructor() { throw new TypeError("Injected parser failure"); } } : URL,
    request: { url: "/sendspin", headers: { origin: "https://lab.example" } },
    socket: { end: (response: string) => responses.push(response) },
    origins: new Set(["https://lab.example"]), sockets: new Set(),
  });
  if (throws) {
    assert.equal(result, undefined);
    assert.deepEqual(responses, ["HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"]);
  } else {
    assert.equal(result, "accepted");
    assert.deepEqual(responses, []);
  }
});
