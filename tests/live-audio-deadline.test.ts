import { expect, test } from "bun:test";
import { remainingTime, requestBeforeDeadline, waitUntil } from "./audio-lab/deadline";

test("a shared deadline bounds server polling, sleep, and a stalled browser reply", async () => {
  const deadline = performance.now() + 250;
  let polls = 0, pending = 0, requests = 0, release: (() => void) | undefined;
  const result = (async () => {
    await waitUntil(() => ++polls > 1, "server reply", deadline);
    await Bun.sleep(Math.min(10, remainingTime(deadline, "drain sleep")));
    await requestBeforeDeadline<void>(deadline, "browser reply", resolve => {
      pending++; requests++;
      release = () => resolve();
      return () => { pending--; };
    });
    return "completed";
  })().catch(error => String(error));
  try {
    const outcome = await Promise.race([result, Bun.sleep(600).then(() => "still pending")]);
    expect(outcome).toContain("Timed out:");
    expect(requests).toBe(1);
    expect(pending).toBe(0);
  } finally { release?.(); await result; }
});

test("expired deadlines do not start another server poll or browser request", async () => {
  let starts = 0;
  const deadline = performance.now() - 1;
  await expect(waitUntil(() => { starts++; return true; }, "server reply", deadline)).rejects.toThrow("Timed out:");
  await expect(requestBeforeDeadline<boolean>(deadline, "browser reply", resolve => {
    starts++; resolve(true); return () => {};
  })).rejects.toThrow("Timed out:");
  expect(starts).toBe(0);
});

test("a stalled server does not start another poll after the sleep budget expires", async () => {
  const deadline = performance.now() + 20, polls: number[] = [];
  await expect(waitUntil(() => { polls.push(performance.now()); return false; }, "server reply", deadline)).rejects.toThrow("Timed out:");
  expect(polls.length).toBeGreaterThan(0);
  expect(polls.every(time => time < deadline)).toBe(true);
});

test("a queued poll rechecks its deadline before invoking the predicate", async () => {
  let starts = 0;
  const deadline = performance.now() + 10;
  queueMicrotask(() => { while (performance.now() <= deadline) { /* Occupy this turn past the deadline. */ } });
  await expect(waitUntil(() => { starts++; return true; }, "queued reply", deadline)).rejects.toThrow("Timed out:");
  expect(starts).toBe(0);
});

test("successful and failed requests dispose their pending registration", async () => {
  let pending = 0;
  const deadline = performance.now() + 1000;
  expect(await requestBeforeDeadline<number>(deadline, "reply", resolve => {
    pending++; resolve(42); return () => { pending--; };
  })).toBe(42);
  await expect(requestBeforeDeadline<void>(deadline, "reply", (_resolve, reject) => {
    pending++; reject(new Error("Worker exited")); return () => { pending--; };
  })).rejects.toThrow("Worker exited");
  expect(pending).toBe(0);
});
