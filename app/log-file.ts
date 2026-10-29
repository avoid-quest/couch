import { appendFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

// The app's log (<data>/logs/couch.log). Each run starts it afresh and keeps the
// previous run's files as couch.1.log and couch.1.log.1. A long run rotates its
// full file to couch.log.1 rather than stop, as t3code's rotating log writer
// does, so late failure evidence survives within 2 × maxBytes per run. Every
// file starts with the run's header, so a rotated tail still names its run.
export function startLog(path: string, maxBytes: number, header: (file: number) => string) {
  const previous = path.replace(/\.log$/, ".1.log");
  for (const [from, to] of [[path, previous], [`${path}.1`, `${previous}.1`]] as const) {
    rmSync(to, { force: true });
    try { renameSync(from, to); } catch {}
  }
  let writable = true, size = 0, count = 0;
  const open = () => {
    const text = header(++count);
    writeFileSync(path, text);
    size = Buffer.byteLength(text);
  };
  try { open(); } catch { writable = false; }
  return (chunk: unknown) => {
    if (!writable || !(typeof chunk === "string" || chunk instanceof Uint8Array)) return;
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
    try {
      if (size + bytes > maxBytes) {
        renameSync(path, `${path}.1`);
        open();
      }
      // Finish and close every write before rotating; Windows can lock open files.
      appendFileSync(path, chunk);
      size += bytes;
    } catch {
      // A full or removed disk stops only the file; the journal and stdout still get everything.
      writable = false;
    }
  };
}
