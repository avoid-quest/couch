import { expect, test } from "bun:test";
import { declareLiveBuffer } from "../src/client/session/live-buffer";

const steady = (latency: number) => Array(5).fill(latency);

test("a Receiver starts at the host floor and waits for five readings before it raises", () => {
  expect(declareLiveBuffer(0, 150)).toBe(150);
  expect(declareLiveBuffer(150, 150, [300, 300, 300, 300])).toBe(150);
  expect(declareLiveBuffer(150, 150, steady(300))).toBe(350);
});

test("a declaration rises only when the smoothed need clearly outgrows it, in whole 25 ms steps", () => {
  // Need = median reading + 35 ms allowance.
  expect(declareLiveBuffer(150, 150, steady(118))).toBe(150);
  expect(declareLiveBuffer(150, 150, steady(140))).toBe(150);
  expect(declareLiveBuffer(150, 150, steady(141))).toBe(200);
  expect(declareLiveBuffer(200, 150, steady(201))).toBe(250);
  expect(declareLiveBuffer(0, 0, steady(27))).toBe(75);
  expect(declareLiveBuffer(75, 0, steady(42))).toBe(75);
});

test("single raw spikes do not move the declaration", () => {
  expect(declareLiveBuffer(150, 150, [42, 42, 900, 42, 42])).toBe(150);
  expect(declareLiveBuffer(150, 150, [42, 900, 42, 900, 42])).toBe(150);
});

test("lower output latency or a lower host floor cannot reduce a running declaration", () => {
  expect(declareLiveBuffer(250, 150, steady(27))).toBe(250);
  expect(declareLiveBuffer(250, 0)).toBe(250);
  expect(declareLiveBuffer(250, 351, steady(118))).toBe(351);
});

test("the declaration respects Core's 5000 ms timing limit", () => {
  expect(declareLiveBuffer(0, 5000, steady(118))).toBe(5000);
  expect(declareLiveBuffer(150, 150, steady(4990))).toBe(5000);
});
