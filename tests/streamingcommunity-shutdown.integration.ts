import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { healStreamingCommunityOrigin } from "../src/server/streamingcommunity";

const site = (origin: string) => {
  const response = new Response(
    '<div data-page="{&quot;component&quot;:&quot;Home&quot;,&quot;props&quot;:{}}"></div>',
  );
  Object.defineProperty(response, "url", { value: origin });
  return response;
};
const originStore = (name: string) => {
  let origin = `https://streamingcommunity${name}.test`;
  const writes: string[] = [];
  return {
    writes,
    streamingCommunityOrigin: () => origin,
    saveStreamingCommunityOrigin: (value: string) => {
      writes.push(value);
      origin = value;
    },
  };
};
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected origin check did not finish.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("startup follows and saves a successful redirect while Core is open", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-origin-open-")),
    databasePath = join(directory, "couch.sqlite");
  const seeded = openStore(databasePath);
  seeded.saveStreamingCommunityOrigin("https://streamingcommunityopen.test");
  seeded.close();
  let release!: (response: Response) => void;
  const request = (() =>
    new Promise<Response>((resolve) => {
      release = resolve;
    })) as typeof fetch;
  const hub = await createHub({
    databasePath,
    hostToken: "h".repeat(64),
    hostname: "127.0.0.1",
    port: 0,
    streamingCommunityFetch: request,
  });
  const observer = openStore(databasePath);
  try {
    release(site("https://streamingcommunityopenmoved.test"));
    await until(
      () => observer.streamingCommunityOrigin() === "https://streamingcommunityopenmoved.test",
    );
    await hub.close();
    assert.equal(observer.streamingCommunityOrigin(), "https://streamingcommunityopenmoved.test");
  } finally {
    observer.close();
    await hub.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unreachable discovery while active keeps the saved origin", async () => {
  const store = originStore("unreachable");
  const request = (async () => {
    throw new Error("Network unavailable");
  }) as typeof fetch;
  const origin = store.streamingCommunityOrigin();
  assert.equal(
    await healStreamingCommunityOrigin(store, new AbortController().signal, request),
    origin,
  );
  assert.deepEqual(store.writes, []);
});
