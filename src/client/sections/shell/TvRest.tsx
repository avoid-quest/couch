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
  // The press that wakes it reaches nothing else: a key's whole press, held or not (key-presses.ts), or a pointer's.
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
    const press = (event: PointerEvent) => {
      if (!wake()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    restart.current = wake;
    setTvRestWake(wake);
    arm();
    const unclaim = claimKeyPresses(wake);
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointermove", wake, true);
    return () => {
      clearTimeout(timer);
      setTvRestWake(null);
      unclaim();
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointermove", wake, true);
    };
  }, []);
  // Something starting wakes it; the wait starts again when it stops.
  useEffect(() => {
    restart.current?.();
  }, [playing]);
  if (!resting) return null;
  // Over everything left open: Radix's panels portal to the body, and sonner's toasts sit at z-index 999999999.
  return createPortal(
    <section
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
