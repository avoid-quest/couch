import { useEffect, useState } from "react";
import { formatDuration } from "@/time-format";
import { coreNow } from "@/core-clock";

/**
 * "Live for 1:12:06", or the time alone (`time`) where a plate sets it large. Only this label ticks. Joining,
 * reconnecting and capture restarts keep Core's publication time.
 */
export function LiveClock({
  startedAt,
  time = false,
  prefix = "Live",
  className,
}: {
  startedAt?: number;
  time?: boolean;
  /** What comes before "for 1:12:06": "Live", "Listening, live", "Sharing". */
  prefix?: string;
  className?: string;
}) {
  const [now, setNow] = useState(coreNow);
  useEffect(() => {
    if (startedAt === undefined) return;
    setNow(coreNow());
    const timer = setInterval(() => setNow(coreNow()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const length = startedAt === undefined ? "" : formatDuration((now - startedAt) / 1000);
  return (
    <span className={className ?? "whitespace-nowrap tabular-nums"}>
      {time ? length : `${prefix}${length ? ` for ${length}` : ""}`}
    </span>
  );
}
