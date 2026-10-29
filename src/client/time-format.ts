export function formatDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(value % 60).padStart(2, "0")}`;
}

/** A clock time as Couch says it everywhere, 24-hour ("18:05"). */
export const formatClock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function formatEndTime(seconds: number, now = Date.now()) {
  return formatClock(now + Math.max(0, seconds) * 1000);
}

/** When a device was last seen, as people say it: just now, 10 min ago, 3 hours ago, yesterday, Tuesday, Oct 3. */
export function formatSeen(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  const hours = Math.floor(minutes / 60);
  if (days === 0 || hours < 6) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  if (days === 1) return "yesterday";
  const date = new Date(at);
  return days < 7 ? date.toLocaleDateString(undefined, { weekday: "long" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" } });
}

/** Browsing reads runtime in minutes; the playback timeline keeps exact seconds. */
export function formatRuntime(seconds: number) {
  const minutes = Math.max(0, Math.ceil(seconds / 60));
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${minutes} min`;
}
