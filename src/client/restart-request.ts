export async function waitForRestart(endpoint: string, headers: Record<string, string>, instanceId: string, signal: AbortSignal, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(1_000, timeoutMs)));
    signal.throwIfAborted();
    const current = await fetch(endpoint, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]) }).then(async reply => reply.ok ? reply.json() : null).catch(() => null);
    if (current?.ready === true && current.instanceId !== instanceId && typeof current.instanceId === "string") return;
  }
  throw new Error("Couch did not reconnect. Inspect couch-tv.service through SSH; its restart limit or startup may have failed. Your saved data has not been restored or replaced.");
}
