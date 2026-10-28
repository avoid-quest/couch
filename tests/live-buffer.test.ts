import { expect, test } from "bun:test";
import { declareLiveBuffer } from "../src/client/session/live-buffer";

test("a Receiver keeps the host floor unless its output latency plus allowance needs more", () => {
  expect(declareLiveBuffer(0, 150, 27)).toBe(150);
  expect(declareLiveBuffer(0, 150, 118)).toBe(155);
  expect(declareLiveBuffer(0, 150, 201)).toBe(240);
  expect(declareLiveBuffer(0, 0, 27)).toBe(65);
  expect(declareLiveBuffer(0, 0, 42)).toBe(80);
});

test("lower output latency or a lower host floor cannot reduce a running declaration", () => {
  expect(declareLiveBuffer(240, 150, 27)).toBe(240);
  expect(declareLiveBuffer(240, 0, 0)).toBe(240);
  expect(declareLiveBuffer(240, 351, 118)).toBe(355);
});

test("unavailable or invalid output readings preserve the floor and the last declaration", () => {
  for (const latency of [undefined, NaN, Infinity, -1]) {
    expect(declareLiveBuffer(0, 150, latency)).toBe(150);
    expect(declareLiveBuffer(240, 150, latency)).toBe(240);
    expect(declareLiveBuffer(0, 0, latency)).toBe(0);
  }
  expect(declareLiveBuffer(0, 0, 0)).toBe(35);
});

test("the declaration respects Core's 5000 ms timing limit", () => {
  expect(declareLiveBuffer(0, 5000, 118)).toBe(5000);
  expect(declareLiveBuffer(0, 150, 4990)).toBe(5000);
});
