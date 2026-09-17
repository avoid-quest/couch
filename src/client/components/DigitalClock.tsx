import { useEffect, useState } from "react";

export function DigitalClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return <time className="header-clock" dateTime={now.toISOString()} aria-label="Current time">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</time>;
}
