import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CouchMark } from "@/components/CouchMark";
import { DigitalClock } from "@/components/DigitalClock";
import { deviceName } from "@/copy";
import { deviceId, useLocalDeviceName } from "@/session/device-id";
import { claimKeyPresses } from "@/key-presses";
import { useSessionGate } from "@/session/session-context";
import { setTvRestWake } from "@/tv-rest";

/** How long the TV waits, with nothing playing and no input, before it rests on its clock. */
const TV_REST_AFTER_MS = 5 * 60_000;

/** The name the TV goes by: its own device name, else its Couch's. */
export function useTvName() {
  const { state, details } = useSessionGate();
  const localName = useLocalDeviceName();
  return deviceName(
    localName ??
      state?.devices?.find((device) => device.id === deviceId())?.name ??
      state?.installationName ??
      details?.name,
  );
}

/** When nothing plays and nobody has pressed anything for a while, the TV shows Couch's mark, the time and its name. */
export function TvRest({ playing }: { playing: boolean }) {
  const { connected } = useSessionGate();
  const name = useTvName();
  const [resting, setResting] = useState(false);
  const playingNow = useRef(playing);
  playingNow.current = playing;
  const restart = useRef<() => void>(undefined);
  const screen = useRef<HTMLElement>(null);
  // The press that wakes it reaches nothing else: a key's whole press, held or not (key-presses.ts), or a pointer's
  // down to its click, which still comes after pointerdown is cancelled and lands on what the clock covered.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asleep = false;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (playingNow.current) return arm();
        asleep = true;
        setResting(true);
      }, TV_REST_AFTER_MS);
    };
    const wake = () => {
      const was = asleep;
      asleep = false;
      setResting(false);
      arm();
      return was;
    };
    let waking = false;
    // Only a real pointer's own events: the Remote and the controller press through element.click().
    const swallow = (event: Event) => {
      if (!waking || !event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (["click", "auxclick", "pointercancel"].includes(event.type)) waking = false;
    };
    const press = (event: PointerEvent) => {
      waking = wake();
      swallow(event);
    };
    const sequence = [
      "pointerup",
      "pointercancel",
      "mousedown",
      "mouseup",
      "contextmenu",
      "click",
      "auxclick",
    ];
    restart.current = wake;
    setTvRestWake(wake);
    arm();
    // A key pressed after it (a press that never clicked) is past it.
    const unclaim = claimKeyPresses(() => {
      waking = false;
      return wake();
    });
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointermove", wake, true);
    for (const type of sequence) window.addEventListener(type, swallow, true);
    return () => {
      clearTimeout(timer);
      setTvRestWake(null);
      unclaim();
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointermove", wake, true);
      for (const type of sequence) window.removeEventListener(type, swallow, true);
    };
  }, []);
  // Something starting wakes it; the wait starts again when it stops.
  useEffect(() => {
    restart.current?.();
  }, [playing]);
  // What it covers is out of reach of focus and screen readers; focus returns where it was on waking.
  useEffect(() => {
    if (!resting) return;
    const focused = document.activeElement;
    const covered = [...document.body.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== screen.current && !element.inert,
    );
    for (const element of covered) element.inert = true;
    // Something opening on the TV while it rests, such as a dialog a phone opened, wakes it.
    const opened = new MutationObserver((changes) => {
      if (changes.some((change) => change.addedNodes.length)) restart.current?.();
    });
    opened.observe(document.body, { childList: true });
    return () => {
      opened.disconnect();
      for (const element of covered) element.inert = false;
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    };
  }, [resting]);
  if (!resting) return null;
  // Over everything left open: Radix's panels portal to the body, and sonner's toasts sit at z-index 999999999.
  return createPortal(
    <section
      ref={screen}
      aria-label="Resting"
      className="fixed inset-0 z-[1000000000] grid place-items-center bg-background"
    >
      <div className="grid justify-items-center gap-6">
        <CouchMark connected={connected} className="size-14" />
        <DigitalClock className="font-display text-[6rem] leading-none font-bold tracking-[-0.03em] text-foreground normal-nums" />
        <span className="text-title text-muted-foreground">{name}</span>
      </div>
    </section>,
    document.body,
  );
}
