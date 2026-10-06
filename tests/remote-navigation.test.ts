import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyboardSensor } from "@dnd-kit/core";
import { sendKey } from "../src/client/navigation";

// Node has EventTarget, but no KeyboardEvent. The real sensor still receives
// the production transport's event and decides activation/movement/end/cancel.
class KeyEvent extends Event {
  key: string;
  code: string;
  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, init); this.key = init.key ?? ""; this.code = init.code ?? "";
  }
}

test("Remote keys activate, move, finish and cancel the installed keyboard drag handler", () => {
  const priorEvent = globalThis.KeyboardEvent, priorWindow = globalThis.window;
  Object.assign(globalThis, { KeyboardEvent: KeyEvent, window: { KeyboardEvent: KeyEvent } });
  try {
    const target = new EventTarget() as unknown as HTMLElement;
    const released: string[] = [], activated: string[] = [], moved: { x: number; y: number }[] = [];
    let ended = 0, cancelled = 0;
    const starts: boolean[] = [];
    const activate = KeyboardSensor.activators[0]!.handler;
    const sensor = Object.create(KeyboardSensor.prototype);
    sensor.props = { active: "row", options: {}, context: { current: { collisionRect: { left: 0, top: 0 }, scrollableAncestors: [] } },
      onMove: (coordinates: { x: number; y: number }) => moved.push(coordinates), onEnd: () => ended++, onCancel: () => cancelled++ };
    sensor.listeners = sensor.windowListeners = { removeAll() {} };
    target.addEventListener("keydown", event => {
      const key = event as unknown as KeyboardEvent;
      if (key.key === " " || key.key === "Enter") {
        starts.push(activate({ nativeEvent: key, target, preventDefault: () => key.preventDefault() } as never,
          { onActivation: () => activated.push(key.code) }, { active: { activatorNode: { current: target } } } as never));
      }
      sensor.handleKeyDown(key);
    });
    target.addEventListener("keyup", event => released.push((event as unknown as KeyboardEvent).code));
    for (const key of [" ", "Enter", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Escape"]) sendKey(target, key);
    assert.deepEqual(starts, [true, true]);
    assert.deepEqual(activated, ["Space", "Enter"]);
    assert.equal(ended, 2);
    assert.equal(cancelled, 1);
    assert.deepEqual(moved, [{ x: 0, y: 25 }, { x: 0, y: -25 }, { x: 25, y: 0 }, { x: -25, y: 0 }]);
    assert.deepEqual(released, ["Space", "Enter", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Escape"]);
  } finally {
    Object.assign(globalThis, { KeyboardEvent: priorEvent, window: priorWindow });
  }
});
