import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { frontendPaths } from "../shared/page-paths";

const types: Record<string, string> = {
  ".html": "text/html;charset=utf-8", ".js": "text/javascript;charset=utf-8", ".css": "text/css;charset=utf-8",
  ".json": "application/json;charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain;charset=utf-8",
};

// Serves Vite's dist, which sits beside the Core bundle (build/core.mjs).
// Page routes get index.html; without a build, they get a plain placeholder.
export function createFrontend(root = fileURLToPath(new URL("../dist", import.meta.url))) {
  const files = new Map<string, string>();
  try {
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) files.set(`/${relative(root, join(entry.parentPath, entry.name)).split(sep).join("/")}`, join(entry.parentPath, entry.name));
    }
  } catch { /* No build yet. */ }
  for (const path of frontendPaths) if (files.has("/index.html")) files.set(path, files.get("/index.html")!);
  return async (path: string): Promise<Response | null> => {
    const file = files.get(path);
    if (!file) return frontendPaths.includes(path) ? new Response("Couch media server") : null;
    return new Response(await readFile(file), { headers: {
      "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache",
      ...(path === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
    } });
  };
}
