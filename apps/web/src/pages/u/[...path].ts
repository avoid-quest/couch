import type { APIRoute } from "astro";

export const prerender = false;

// Same-origin tracking, as in avoid-quest/avoid.quest's web package.
export const ALL: APIRoute = async ({ params, request }) => {
  const isScript = params.path === "script.js";
  if (!isScript && params.path !== "api/send") return new Response("Not found", { status: 404 });
  const methods = isScript ? ["GET", "HEAD"] : ["POST"];
  if (!methods.includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: methods.join(", ") } });

  const headers = new Headers();
  for (const name of ["content-type", "user-agent", "x-umami-cache", "x-umami-website-id", "x-umami-hostname"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let body: string | undefined;
  if (!isScript) {
    try {
      const event = await request.json();
      if (!event?.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("Invalid event");
      // Cloudflare rewrites visitor headers on cross-zone Worker requests.
      // Umami's payload.ip takes precedence; trust only Cloudflare's incoming IP.
      event.payload.ip = request.headers.get("cf-connecting-ip") ?? undefined;
      body = JSON.stringify(event);
    } catch {
      return new Response("Invalid event", { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }

  try {
    const upstream = await fetch(`https://umami.net-work.studio/${isScript ? "script.js" : "api/send"}`, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      throw new Error("Unexpected redirect");
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? (isScript ? "application/javascript" : "application/json"),
        "Cache-Control": isScript && upstream.ok ? "public, max-age=3600" : "no-store",
      },
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
};
