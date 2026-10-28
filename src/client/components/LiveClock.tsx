import { useEffect, useState } from "react";
import { formatDuration } from "@/time-format";

/** Only this label ticks. Joining, reconnecting and capture restarts keep Core's publication time. */
export function LiveClock({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <span className="whitespace-nowrap tabular-nums">Live{startedAt === undefined ? "" : ` · ${formatDuration((now - startedAt) / 1000)}`}</span>;
}
