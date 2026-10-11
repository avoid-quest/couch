export function formatDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(value % 60).padStart(2, "0")}`;
}

export function formatEndTime(seconds: number, now = Date.now()) {
  return new Date(now + Math.max(0, seconds) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
