import { expect, test } from "bun:test";
import { connectUpdater } from "./updater-client";

function fixture(handle: (value: unknown) => Promise<unknown> = async () => ({})) {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  let lost = 0, killed = false;
  const exited = Promise.withResolvers<number>();
  const written: Record<string, unknown>[] = [];
  const available = Promise.withResolvers<void>();
  const child = {
    stdout: new ReadableStream<Uint8Array>({ start(controller) { output = controller; } }),
    stdin: { write(data: string) { written.push(JSON.parse(data)); available.resolve(); }, flush() {} },
    exited: exited.promise,
    kill() { if (killed) return; killed = true; output.close(); exited.resolve(0); },
  } as unknown as Parameters<typeof connectUpdater>[0];
  const client = connectUpdater(child, handle, () => lost++);
  const emit = (value: unknown) => output.enqueue(Buffer.from(JSON.stringify(value) + "\n"));
  emit({ kind: "ready" });
  return { client, emit, written, available: available.promise, lost: () => lost, exit: () => child.kill() };
}

test("private worker replies must match the exact outstanding request", async () => {
  const f = fixture();
  try {
    await f.client.ready;
    const response = f.client.request({ op: "context" });
    await f.available;
    expect(f.written[0]).toMatchObject({ kind: "worker", payload: { op: "context" } });
    f.emit({ kind: "result", id: f.written[0]!.id, payload: { ok: true, context: null } });
    expect(await response).toEqual({ ok: true, context: null });
    expect(f.lost()).toBe(0);
  } finally { await f.client.close(); }
});

test.each(["unknown", "malformed", "exit"])("%s bridge output closes admission and rejects pending work", async scenario => {
  const f = fixture();
  try {
    const response = f.client.request({ op: "context" });
    const rejected = response.catch(error => error);
    await f.available;
    if (scenario === "exit") f.exit();
    else f.emit(scenario === "unknown" ? { kind: "result", id: "a".repeat(32), payload: { ok: true } } : { kind: "result", id: f.written[0]!.id, payload: {}, extra: true });
    expect(await rejected).toBeInstanceOf(Error);
    expect(f.lost()).toBe(1);
  } finally { await f.client.close(); }
});

test("bridge loss while maintenance runs prevents a late reply", async () => {
  const started = Promise.withResolvers<void>(), completed = Promise.withResolvers<object>();
  const f = fixture(async () => { started.resolve(); return completed.promise; });
  try {
    await f.client.ready;
    f.emit({ kind: "request", id: "a".repeat(32), payload: { nonce: "private" } });
    await started.promise;
    f.exit();
    await Promise.resolve();
    completed.resolve({ ok: true, nonce: "private" });
    await completed.promise;
    await Promise.resolve();
    expect(f.written).toEqual([]);
    expect(f.lost()).toBe(1);
  } finally { completed.resolve({}); await f.client.close(); }
});
