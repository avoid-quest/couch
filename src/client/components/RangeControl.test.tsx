import { setupUiTests, render as renderUI, screen } from "../testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";

setupUiTests();
let RangeControl: typeof import("./RangeControl")["RangeControl"];
let view: ReturnType<typeof renderUI>;
const requests: { value: number; resolve: (accepted?: boolean) => void; reject: (error: Error) => void }[] = [];
const commit = (value: number) => new Promise<boolean>((resolve, reject) => requests.push({ value, resolve: (accepted = true) => resolve(accepted), reject }));
const render = async (value = 12.38, { disabled = false, playbackId = "first", volume = false } = {}) => act(async () => view.rerender(<RangeControl key={playbackId} label={volume ? "Volume" : "Playback position"} value={value} max={volume ? 100 : 60} disabled={disabled} onCommit={commit} showValue={volume} keyboardStep={volume ? 1 : 10} />));
const slider = () => screen.getByRole("slider");
const key = async (key: string) => act(async () => { slider().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); slider().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true })); });
beforeEach(async () => {
  requests.length = 0;
  spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(() => {});
  spyOn(HTMLElement.prototype, "hasPointerCapture").mockReturnValue(true);
  spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(() => {});
  ({ RangeControl } = await import("./RangeControl"));
  view = renderUI(null);
});
test("Home followed by four arrows seeks forty seconds while player observations lag acknowledgements", async () => {
  await render();
  await key("Home");
  await act(async () => requests[0]!.resolve());
  for (let i = 0; i < 4; i++) { await key("ArrowRight"); await act(async () => requests.at(-1)!.resolve()); }
  expect(requests.map(request => request.value)).toEqual([0, 10, 20, 30, 40]);
  expect(slider().getAttribute("aria-valuenow")).toBe("40");
});

test("an old acknowledgement does not discard a newer keyboard edit", async () => {
  await render();
  await key("Home");
  await key("ArrowRight");
  await act(async () => requests[0]!.resolve());
  await key("ArrowRight");
  expect(requests.map(request => request.value)).toEqual([0, 10, 20]);
});

test("authoritative observations continue after leaving the keyboard edit", async () => {
  await render();
  await key("Home");
  await render(0.02);
  await act(async () => slider().blur());
  await render(1.25);
  expect(slider().getAttribute("aria-valuenow")).toBe("1.25");
});

const pointer = async (type: string, clientX: number) => act(async () => {
  const element = slider();
  element.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));
  if (type === "pointerdown") element.dispatchEvent(new PointerEvent("pointermove", { clientX, pointerId: 1, bubbles: true }));
});

test("pointer volume commits on release and returns to the observed level after acknowledgement", async () => {
  await render(50, { volume: true });
  await pointer("pointerdown", 20);
  await pointer("pointermove", 30);
  expect(requests).toHaveLength(0);
  expect(slider().getAttribute("aria-valuenow")).toBe("30");
  await pointer("pointerup", 30);
  expect(requests.map(request => request.value)).toEqual([30]);
  await render(30, { volume: true });
  await act(async () => requests[0]!.resolve());
  await render(45, { volume: true });
  expect(slider().getAttribute("aria-valuenow")).toBe("45");
});

test("an older pointer acknowledgement cannot discard the next drag", async () => {
  await render(50, { volume: true });
  await pointer("pointerdown", 20);
  await pointer("pointerup", 20);
  await pointer("pointerdown", 30);
  await act(async () => requests[0]!.resolve());
  expect(slider().getAttribute("aria-valuenow")).toBe("30");
  await pointer("pointerup", 30);
  expect(requests.map(request => request.value)).toEqual([20, 30]);
});

test("cancel and disconnect discard drafts without another command", async () => {
  await render();
  await key("Home");
  await pointer("pointercancel", 0);
  expect(slider().getAttribute("aria-valuenow")).toBe("12.38");
  await key("Home");
  await render(12.38, { disabled: true });
  expect(slider().getAttribute("aria-valuenow")).toBe("12.38");
  await key("ArrowRight");
  expect(requests.map(request => request.value)).toEqual([0, 0]);
});

test("a new playback identity discards the old draft and acknowledgement", async () => {
  await render();
  await key("Home");
  await render(24, { playbackId: "second" });
  await key("ArrowRight");
  await act(async () => requests[0]!.resolve());
  expect(requests.map(request => request.value)).toEqual([0, 34]);
  expect(slider().getAttribute("aria-valuenow")).toBe("34");
});


test("failed commands release the draft, but old rejections preserve newer edits", async () => {
  await render();
  await key("Home");
  await key("ArrowRight");
  await act(async () => requests[0]!.reject(new Error("Old command rejected")));
  expect(slider().getAttribute("aria-valuenow")).toBe("10");
  await act(async () => requests[1]!.resolve(false));
  expect(slider().getAttribute("aria-valuenow")).toBe("12.38");
  await key("Home");
  await act(async () => requests[2]!.reject(new Error("Connection lost")));
  expect(slider().getAttribute("aria-valuenow")).toBe("12.38");
});

test("late playback observations do not interrupt a focused keyboard edit", async () => {
  await render();
  await key("Home");
  await key("ArrowRight");
  await act(async () => requests.forEach(request => request.resolve()));
  await render(0.02);
  await key("ArrowRight");
  await render(1.02);
  expect(requests.map(request => request.value)).toEqual([0, 10, 20]);
  expect(slider().getAttribute("aria-valuenow")).toBe("20");
  await act(async () => slider().blur());
  expect(slider().getAttribute("aria-valuenow")).toBe("1.02");
});
