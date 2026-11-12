import { useEffect, useEffectEvent } from "react";
import type { NavigationKey } from "../shared/protocol";
import { startHold } from "./hold";
import { isTvPresentation } from "./session/presentation";

type Direction = "up" | "down" | "left" | "right";
// PROTOTYPE: Triangle is Info, Square plays or pauses, L1/R1 step the volume.
type Control = Direction | "ok" | "back" | "info" | "playpause" | "quieter" | "louder";

// Button indices of the standard mapping (https://w3c.github.io/gamepad/#remapping): the bottom face button
// (A, Cross) is OK, the right one (B, Circle) is Back, 12–15 the D-pad. The Guide button (16) stays Steam's.
const buttons: [Control, number][] = [
  ["ok", 0],
  ["back", 1],
  ["info", 3],
  ["playpause", 2],
  ["quieter", 4],
  ["louder", 5],
  ["up", 12],
  ["down", 13],
  ["left", 14],
  ["right", 15],
];
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
 * Turns controller frames into remote keys, as a remote's OK and arrows send them: OK on release or, held, the
 * item's menu; arrows repeat while held. It acts only while Couch is in front, and a control already held when Couch
 * comes to the front (A on Steam's Couch tile) waits for its release.
 */
export function gamepadReader(navigate: (key: NavigationKey) => void) {
  let previous = new Set<Control>();
  let inFront = true;
  let ok: ReturnType<typeof startHold> | null = null;
  const repeats = new Map<Direction, number>();
  const volumeRepeats = new Map<Control, number>();
  const stop = () => {
    ok?.release();
    ok = null;
    repeats.clear();
  };
  const read = (pads: readonly (Gamepad | null)[], focused: boolean, now: number) => {
    const held = heldControls(pads);
    const before = previous;
    const arriving = !inFront;
    previous = held;
    inFront = focused;
    if (!focused) stop();
    if (!focused || arriving) return;
    const pressed = (control: Control) => held.has(control) && !before.has(control);
    if (pressed("back")) navigate("back");
    if (pressed("info")) navigate("info");
    // PROTOTYPE: the one Play/Pause on screen (the player's, else the now-playing bar's).
    if (pressed("playpause"))
      document.querySelector<HTMLElement>("[data-play-button]:not(:disabled)")?.click();
    for (const [control, by] of [
      ["quieter", -2],
      ["louder", 2],
    ] as const) {
      const step = (repeat: boolean) =>
        window.dispatchEvent(new CustomEvent("couch-volume-step", { detail: { by, repeat } }));
      const next = volumeRepeats.get(control);
      if (!held.has(control)) volumeRepeats.delete(control);
      else if (pressed(control)) {
        step(false);
        volumeRepeats.set(control, now + repeatDelay);
      } else if (next !== undefined && now >= next) {
        step(true);
        volumeRepeats.set(control, now + 250);
      }
    }
    if (pressed("ok")) ok = startHold(() => navigate("menu"));
    if (ok && !held.has("ok")) {
      if (ok.release()) navigate("select");
      ok = null;
    }
    for (const direction of ["up", "down", "left", "right"] as const) {
      const next = repeats.get(direction);
      if (!held.has(direction)) repeats.delete(direction);
      else if (pressed(direction)) {
        navigate(direction);
        repeats.set(direction, now + repeatDelay);
      } else if (next !== undefined && now >= next) {
        navigate(direction);
        repeats.set(direction, now + repeatInterval);
      }
    }
  };
  return { read, stop };
}

/** On the TV, a game controller drives Couch as the remote does; it is read only while one is connected. */
export function useGamepadNavigation(onNavigate: (key: NavigationKey) => void) {
  // The hold's timer can fire between frames, after Couch went behind a game.
  const navigate = useEffectEvent((key: NavigationKey) => {
    if (document.hasFocus()) onNavigate(key);
  });
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
      reader!.read(pads, document.hasFocus(), now);
      frame = requestAnimationFrame(poll);
    };
    const connected = () => {
      if (reader || !navigator.getGamepads().some(Boolean)) return;
      reader = gamepadReader(navigate);
      frame = requestAnimationFrame(poll);
    };
    connected();
    window.addEventListener("gamepadconnected", connected);
    return () => {
      window.removeEventListener("gamepadconnected", connected);
      end();
    };
  }, []);
}
