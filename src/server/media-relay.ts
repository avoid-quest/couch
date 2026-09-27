const lifetime = 24 * 60 * 60 * 1_000;
const requestHeaders = ["range", "if-range", "if-none-match", "if-modified-since"];
const responseHeaders = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

type Grant = {
  playbackId: string;
  source: string;
  headers: Headers;
  authorize: () => void;
  expires: number;
  timer: ReturnType<typeof setTimeout>;
  active: Set<AbortController>;
};

/** Attempt-scoped capabilities for a fixed, privately authenticated media resource. */
export function createMediaRelay({ fetch: fetchMedia = fetch, now = Date.now }: {
  fetch?: typeof fetch;
  now?: () => number;
} = {}) {
  const grants = new Map<string, Grant>();
  let closed = false;
  const remove = (token: string) => {
    const grant = grants.get(token);
    if (!grant) return;
    grants.delete(token);
    clearTimeout(grant.timer);
    for (const controller of grant.active) controller.abort();
  };
  const failure = (status: number) => new Response(null, { status, headers: privateHeaders });

  return {
    issue(playbackId: string, media: { source: string; headers?: Record<string, string> }, authorize: () => void) {
      let source: URL;
      try { source = new URL(media.source); } catch { throw new Error("Invalid media resource"); }
      if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new Error("Invalid media resource");
      for (const [token, grant] of grants) if (grant.expires <= now()) remove(token);
      if (closed || grants.size >= 32) throw new Error("Media relay unavailable");
      let headers: Headers;
      try { headers = new Headers(media.headers); } catch { throw new Error("Invalid media resource"); }
      const token = crypto.randomUUID();
      const timer = setTimeout(() => remove(token), lifetime);
      timer.unref();
      grants.set(token, { playbackId, source: source.href, headers, authorize, expires: now() + lifetime, timer, active: new Set() });
      return `/api/media/${token}`;
    },
    revoke(playbackId: string) {
      for (const [token, grant] of grants) if (grant.playbackId === playbackId) remove(token);
    },
    close() {
      closed = true;
      for (const token of grants.keys()) remove(token);
    },
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      const match = /^\/api\/media\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (!match) return null;
      if (url.search) return failure(404);
      const token = match[1]!;
      const grant = grants.get(token);
      if (!grant) return failure(404);
      if (grant.expires <= now()) { remove(token); return failure(404); }
      if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405);
      try { grant.authorize(); } catch { remove(token); return failure(404); }
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      grant.active.add(controller);
      const timeout = setTimeout(abort, 15_000);
      timeout.unref();
      const cleanup = () => {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abort);
        grant.active.delete(controller);
      };
      try {
        const headers = new Headers(grant.headers);
        // Keep byte ranges and upstream lengths consistent: do not negotiate compression.
        headers.set('accept-encoding', 'identity');
        for (const name of requestHeaders) {
          const value = request.headers.get(name);
          if (value !== null) headers.set(name, value);
        }
        const upstream = await fetchMedia(grant.source, { method: request.method, headers, signal: controller.signal, redirect: 'error' });
        clearTimeout(timeout); // Only headers have a deadline; media bodies can run for hours.
        if (controller.signal.aborted || ![200, 206, 304, 416].includes(upstream.status)) {
          await upstream.body?.cancel();
          cleanup();
          return failure(502);
        }
        const outgoing = new Headers(privateHeaders);
        for (const name of responseHeaders) {
          const value = upstream.headers.get(name);
          if (value !== null) outgoing.set(name, value);
        }
        if (!upstream.body || request.method === 'HEAD' || upstream.status === 304) {
          await upstream.body?.cancel();
          cleanup();
          return new Response(null, { status: upstream.status, headers: outgoing });
        }
        const reader = upstream.body.getReader();
        let stop: () => void;
        const finish = () => { controller.signal.removeEventListener('abort', stop); cleanup(); };
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            stop = () => {
              stream.error(new Error('Media stream unavailable'));
              void reader.cancel().catch(() => {});
              finish();
            };
            controller.signal.addEventListener('abort', stop, { once: true });
            if (controller.signal.aborted) stop();
          },
          async pull(stream) {
            try {
              const { done, value } = await reader.read();
              if (controller.signal.aborted) return;
              if (done) { finish(); stream.close(); } else stream.enqueue(value);
            } catch { finish(); stream.error(new Error('Media stream unavailable')); }
          },
          async cancel() {
            finish();
            controller.abort();
            await reader.cancel().catch(() => {});
          },
        });
        return new Response(body, { status: upstream.status, headers: outgoing });
      } catch {
        controller.abort();
        cleanup();
        return failure(502);
      }
    },
  };
}
