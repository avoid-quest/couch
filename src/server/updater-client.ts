import type { Subprocess } from "bun";

const limit = 65_536;
const failure = () => new Error("The private update worker connection stopped.");
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

// Only the installed bridge may supply maintenance requests. It checks Linux
// peer credentials; the browser never receives this channel or its nonce.
export function createUpdaterClient(handle: (request: unknown) => Promise<unknown>, lost: () => void) {
  const child: Subprocess<"pipe", "pipe", "ignore"> = Bun.spawn(["/usr/bin/python3", "-I", "/usr/lib/couch-appliance/updater/bridge.py"], {
    stdin: "pipe", stdout: "pipe", stderr: "ignore", env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
  });
  return connectUpdater(child, handle, lost);
}

export function connectUpdater(child: Pick<Subprocess<"pipe", "pipe", "ignore">, "stdin" | "stdout" | "exited" | "kill">, handle: (request: unknown) => Promise<unknown>, lost: () => void) {
  const pending = new Map<string, Pending>();
  const incoming = new Set<string>();
  const started = Promise.withResolvers<void>();
  let closed = false, ready = false;
  const stop = (unexpected: boolean) => {
    if (closed) return;
    closed = true;
    clearTimeout(startup);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(failure()); }
    pending.clear();
    started.reject(failure());
    child.kill();
    if (unexpected) lost();
  };
  const startup = setTimeout(() => stop(true), 5_000);
  const send = (value: unknown) => {
    if (closed) throw failure();
    const data = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(data) > limit) throw failure();
    child.stdin.write(data);
    void Promise.resolve(child.stdin.flush()).catch(() => stop(true));
  };
  const receive = (value: unknown) => {
    if (!value || typeof value !== "object" || !("kind" in value)) throw failure();
    if (value.kind === "ready" && !ready && Object.keys(value).length === 1) {
      ready = true;
      clearTimeout(startup);
      started.resolve();
      return;
    }
    if (!ready || !("id" in value) || typeof value.id !== "string" || !/^[a-f0-9]{32}$/.test(value.id) || !("payload" in value) || Object.keys(value).length !== 3) throw failure();
    const id = value.id;
    if (value.kind === "result") {
      const item = pending.get(id);
      if (!item) throw failure();
      clearTimeout(item.timer);
      pending.delete(id);
      item.resolve(value.payload);
    } else if (value.kind === "request" && incoming.size < 8 && !incoming.has(id)) {
      incoming.add(id);
      const timer = setTimeout(() => stop(true), 30_000);
      void handle(value.payload).then(payload => { if (!closed) send({ kind: "reply", id, payload }); }).catch(() => stop(true)).finally(() => { clearTimeout(timer); incoming.delete(id); });
    } else throw failure();
  };
  const reading = (async () => {
    const reader = child.stdout.getReader();
    let buffered = Buffer.alloc(0);
    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered = Buffer.concat([buffered, value]);
        if (buffered.length > limit) throw failure();
        let newline: number;
        while ((newline = buffered.indexOf(10)) !== -1) {
          receive(JSON.parse(buffered.subarray(0, newline).toString("utf8")));
          buffered = buffered.subarray(newline + 1);
        }
      }
    } catch { /* Keep private payloads out of diagnostic logs. */ }
    finally { reader.releaseLock(); stop(true); }
  })();
  void child.exited.then(() => stop(true));
  return {
    ready: started.promise,
    async request(payload: { op: "context" } | { op: "status"; requestId?: string } | { op: "install"; candidateId: string; requestId: string; confirmInterrupt: boolean }) {
      await started.promise;
      if (closed || pending.size >= 8) throw failure();
      const id = crypto.randomUUID().replaceAll("-", "");
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject, timer: setTimeout(() => stop(true), 10_000) });
        try { send({ kind: "worker", id, payload }); } catch { stop(true); }
      });
    },
    async close() { stop(false); await Promise.all([child.exited, reading]); },
  };
}
