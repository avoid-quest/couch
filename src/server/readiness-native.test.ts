import { expect, test } from "bun:test";
import { createNativeReadiness } from "./readiness-native";

const build = { version: "2", revision: "a".repeat(40), dataFormat: 1 };

test("native startup requires its current nonce and propagates initialization failure", async () => {
  let nonce = "";
  const native = createNativeReadiness(value => nonce = value);
  try {
    const result = native.collect();
    native.receive("wrong", true, build);
    native.receive(nonce, true, build);
    expect(await result).toEqual(build);
    const failed = native.collect().catch(error => error);
    native.receive(nonce, false, build);
    expect(await failed).toBeInstanceOf(Error);
  } finally { native.close(); }
});

test("a timed out native request cannot satisfy a later trial poll", async () => {
  const nonces: string[] = [];
  const native = createNativeReadiness(value => nonces.push(value), 10);
  try {
    const expired = native.collect().catch(error => error);
    expect(await expired).toBeInstanceOf(Error);
    const next = native.collect();
    expect(nonces[0]).not.toBe(nonces[1]);
    native.receive(nonces[0]!, true, build);
    native.receive(nonces[1]!, true, { ...build, revision: "not-a-build" });
    expect(await next.catch(error => error)).toBeInstanceOf(Error);
  } finally { native.close(); }
});
