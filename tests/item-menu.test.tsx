import { expect, test } from "bun:test";
import { startHold } from "../src/client/hold";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("a press released before the hold acts once on release; one held opens the menu once and doesn't act", async () => {
  let held = 0;
  const short = startHold(() => held++, 40);
  await wait(10);
  expect(short.release()).toBe(true);
  await wait(60);
  expect(held).toBe(0);
  const long = startHold(() => held++, 40);
  await wait(60);
  expect(held).toBe(1);
  expect(long.release()).toBe(false);
  await wait(60);
  expect(held).toBe(1);
});
