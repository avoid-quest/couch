import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function DigitalClock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return <time className={cn("text-base tabular-nums", className)} dateTime={now.toISOString()} aria-label="Current time">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</time>;
}
