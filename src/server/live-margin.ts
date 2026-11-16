// Diagnostic only: drop this file and its calls in scheduled-audio.ts. Every 10 s per Live listener,
// one log line on how far ahead of its play time Core sent each chunk, how much its socket held
// unsent, and the longest wait between two sends (an event-loop stall shows there).
const windowUs = 10_000_000;

const at = (sorted: number[], fraction: number) =>
  sorted.length ? sorted[Math.floor(fraction * (sorted.length - 1))]!.toFixed(1) : "-";

export function createLiveMarginLog(log: (line: string) => void) {
  const listeners = new Map<
    string,
    { startedUs: number; margins: number[]; gaps: number[]; lastUs?: number; buffered: number }
  >();
  return (name: string, playUs: number, bufferedBytes: number, nowUs: number) => {
    const listener = listeners.get(name) ?? {
      startedUs: nowUs,
      margins: [],
      gaps: [],
      buffered: 0,
    };
    listeners.set(name, listener);
    listener.margins.push((playUs - nowUs) / 1000);
    if (listener.lastUs !== undefined) listener.gaps.push((nowUs - listener.lastUs) / 1000);
    listener.lastUs = nowUs;
    listener.buffered = Math.max(listener.buffered, bufferedBytes);
    if (nowUs - listener.startedUs < windowUs) return;
    const margins = listener.margins.sort((a, b) => a - b),
      gaps = listener.gaps.sort((a, b) => a - b);
    log(
      `live margin ${JSON.stringify(name)}: ${((nowUs - listener.startedUs) / 1e6).toFixed(1)} s, ${margins.length} chunks` +
        ` | send margin ms min ${at(margins, 0)} p1 ${at(margins, 0.01)} p50 ${at(margins, 0.5)}` +
        ` | send gaps ms p50 ${at(gaps, 0.5)} p99 ${at(gaps, 0.99)} max ${at(gaps, 1)}` +
        ` | bufferedAmount max ${listener.buffered} B`,
    );
    listeners.set(name, { startedUs: nowUs, margins: [], gaps: [], lastUs: nowUs, buffered: 0 });
  };
}
