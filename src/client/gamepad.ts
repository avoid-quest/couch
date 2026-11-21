import { useEffect, useEffectEvent } from "react";
import type { NavigationKey } from "../shared/protocol";
import { startHold } from "./hold";
import { claimKeyPresses } from "./key-presses";
import { isTvPresentation } from "./session/presentation";
import { wakeTvRest } from "./tv-rest";

type Direction = "up" | "down" | "left" | "right";
type Control = Direction | "ok" | "back";

// Button indices of the standard mapping (https://w3c.github.io/gamepad/#remapping): the bottom face button
// (A, Cross) is OK, the right one (B, Circle) is Back, 12–15 the D-pad.
const buttons: [Control, number][] = [
  ["ok", 0],
  ["back", 1],
  ["up", 12],
  ["down", 13],
  ["left", 14],
  ["right", 15],
];
// The keys a controller's press can also arrive as, from Steam's desktop layout.
const echoes: Record<string, Control> = {
  Enter: "ok",
  Escape: "back",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
// A press and its key echo arrive a frame or two apart; nobody presses one control on two devices this close together.
const echoWindow = 100;
// Half the stick's travel, so a resting or brushed stick never moves focus.
const deadzone = 0.5;
// As a remote's key repeat: a pause so one press moves once, then steps slow enough to follow.
const repeatDelay = 400;
const repeatInterval = 100;

function heldControls(pads: readonly (Gamepad | null)[]) {
  const held = new Set<Control>();
  for (const pad of pads) {
    // Other mappings put their buttons anywhere; guessing would move Couch on the wrong ones.
    if (pad?.mapping !== "standard") continue;
    for (const [control, index] of buttons) if (pad.buttons[index]?.pressed) held.add(control);
    // The left stick counts along its stronger axis, as one direction of the D-pad.
    const [x = 0, y = 0] = pad.axes;
    if (Math.max(Math.abs(x), Math.abs(y)) < deadzone) continue;
    if (Math.abs(x) > Math.abs(y)) held.add(x < 0 ? "left" : "right");
    else held.add(y < 0 ? "up" : "down");
  }
  return held;
}

/**
 * A controller is the TV's own remote: it sends the remote's keys only while Couch has focus, as a keyboard does, and
 * a press its driver also sends as a key (key) acts once.
 */
export function gamepadReader(
  navigate: (key: NavigationKey) => void,
  focused: () => boolean,
  wake: () => boolean,
) {
  let previous = new Set<Control>();
  let hadFocus = true;
  let ok: ReturnType<typeof startHold> | null = null;
  const repeats = new Map<Direction, number>();
  // Controls whose press does nothing more until they are released.
  const spent = new Set<Control>();
  const pressedAt = new Map<Control, number>();
  const keyedAt = new Map<Control, number>();
  const together = (times: Map<Control, number>, control: Control, at: number) =>
    Math.abs(at - (times.get(control) ?? -Infinity)) < echoWindow;
  const stop = () => {
    ok?.release();
    ok = null;
    repeats.clear();
  };
  const read = (pads: readonly (Gamepad | null)[], now: number) => {
    const held = heldControls(pads);
    const before = previous;
    const focus = focused();
    const arriving = !hadFocus;
    previous = held;
    hadFocus = focus;
    for (const control of spent) if (!held.has(control)) spent.delete(control);
    if (!focus) stop();
    if (!focus || arriving) return;
    const pressed = (control: Control) => held.has(control) && !before.has(control);
    const presses = [...held].filter(pressed);
    const woke = presses.length > 0 && wake();
    for (const control of presses) {
      // A matched press and echo are spent, so the next tap of that control, however quick, acts.
      const echoed = together(keyedAt, control, now);
      if (echoed) keyedAt.delete(control);
      else pressedAt.set(control, now);
      if (woke || echoed) spent.add(control);
    }
    const acts = (control: Control) => pressed(control) && !spent.has(control);
    if (acts("back")) navigate("back");
    // The hold's timer can fire between frames, after Couch lost focus.
    if (acts("ok")) ok = startHold(() => focused() && navigate("menu"));
    if (ok && !held.has("ok")) {
      if (ok.release()) navigate("select");
      ok = null;
    }
    for (const direction of ["up", "down", "left", "right"] as const) {
      const next = repeats.get(direction);
      if (!held.has(direction) || spent.has(direction)) repeats.delete(direction);
      else if (pressed(direction)) {
        navigate(direction);
        repeats.set(direction, now + repeatDelay);
      } else if (next !== undefined && now >= next) {
        navigate(direction);
        repeats.set(direction, now + repeatInterval);
      }
    }
  };
  /** A key pressed at a time: says whether it echoes a press this controller already acted on. */
  const key = (name: string, at: number) => {
    const control = echoes[name];
    if (!control) return false;
    // Only while the controller holds it, so a key typed on a keyboard meanwhile still counts.
    const echo = previous.has(control) && together(pressedAt, control, at);
    if (echo) pressedAt.delete(control);
    else keyedAt.set(control, at);
    return echo;
  };
  return { read, key, stop };
}

/** On the TV, a game controller drives Couch as the remote does; it is read only while one is connected. */
export function useGamepadNavigation(onNavigate: (key: NavigationKey) => void) {
  const navigate = useEffectEvent(onNavigate);
  useEffect(() => {
    if (!isTvPresentation()) return;
    let reader: ReturnType<typeof gamepadReader> | null = null;
    let frame = 0;
    const end = () => {
      cancelAnimationFrame(frame);
      reader?.stop();
      reader = null;
    };
    const poll = (now: number) => {
      const pads = navigator.getGamepads();
      // The last controller left: stop until one connects again.
      if (!pads.some(Boolean)) {
        end();
        return;
      }
      reader!.read(pads, now);
      frame = requestAnimationFrame(poll);
    };
    const connected = () => {
      if (reader || !navigator.getGamepads().some(Boolean)) return;
      reader = gamepadReader(navigate, () => document.hasFocus(), wakeTvRest);
      frame = requestAnimationFrame(poll);
    };
    connected();
    const unclaim = claimKeyPresses((event) => reader?.key(event.key, event.timeStamp) ?? false);
    window.addEventListener("gamepadconnected", connected);
    return () => {
      window.removeEventListener("gamepadconnected", connected);
      unclaim();
      end();
    };
  }, []);
}
