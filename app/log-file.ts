import { createWriteStream, openSync, renameSync, rmSync, type WriteStream } from "node:fs";

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
  let file: WriteStream | null = null, size = 0, count = 0;
  const open = () => {
    // Open now, so a rotation renames the file its pending writes go to.
    let stream: WriteStream;
    try { stream = createWriteStream(path, { fd: openSync(path, "w") }); } catch { file = null; return; }
    // A full or removed disk stops only the file; the journal and stdout still get everything.
    stream.on("error", () => { if (file === stream) file = null; });
    const text = header(++count);
    stream.write(text);
    file = stream;
    size = Buffer.byteLength(text);
  };
  open();
  return (chunk: unknown) => {
    if (!file || !(typeof chunk === "string" || chunk instanceof Uint8Array)) return;
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
    if (size + bytes > maxBytes) {
      file.end();
      try { renameSync(path, `${path}.1`); } catch { file = null; return; }
      open();
    }
    file?.write(chunk);
    size += bytes;
  };
}
