import { strict as assert } from "node:assert";
import { buildKey } from "../../src/shared/build";

// Programmatic remotes identify the server bundle they are exercising, just as
// the compiled phone frontend does before opening its control connection.
export async function remoteSocketUrl(origin: string, token: string) {
  const response = await fetch(`${origin}/api/build`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200, "The paired remote reads the packaged build identity");
  const build = buildKey(await response.json());
  assert.ok(build, "The native fixture has an immutable packaged build identity");
  return `${origin.replace("http", "ws")}/api/ws?token=${encodeURIComponent(token)}&build=${encodeURIComponent(build)}`;
}
