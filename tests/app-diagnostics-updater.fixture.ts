// Bundled by app-diagnostics.native.ts, then run inside the real Electron Main.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import updater from "electron-updater";
import { DownloadedUpdateHelper } from "electron-updater/out/DownloadedUpdateHelper";
import { startUpdates } from "../app/update";

export async function exerciseUpdater(directory: string, port: number) {
  startUpdates({ channelPath: join(directory, "update-channel"), tv: false, onState() {} });
  let filesystemErrors = 0;
  for (const separator of [" ", "\t", "\n", "\u2028", "'", "' ", '"', '" ']) {
    try { readFileSync(join(directory, `missing${separator}synthetic-updater-path.txt`)); }
    catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      filesystemErrors++;
      // The installed updater's original error listener supplies its real stack.
      updater.autoUpdater.emit("error", error as Error);
    }
  }
  assert.equal(filesystemErrors, 8);
  const server = createServer((request, response) => {
    response.writeHead(401, { "Content-Type": request.url === "/json" ? "application/json" : "text/plain" });
    response.end(JSON.stringify({ token: request.url === "/json" ? "synthetic-json-control" : 'synthetic-updater-before"synthetic-updater-after' }));
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  const httpErrors: { path: string; statusCode: number }[] = [];
  try {
    // The installed runtime exposes this executor internally; no request/error mock.
    const executor = (updater.autoUpdater as unknown as { httpExecutor: { request(options: object): Promise<unknown> } }).httpExecutor;
    for (const path of ["/plain", "/json"]) {
      try { await executor.request({ protocol: "http:", hostname: "127.0.0.1", port, path, method: "GET" }); }
      catch (error) {
        assert.equal((error as Error).name, "HttpError");
        const statusCode = (error as Error & { statusCode: number }).statusCode;
        assert.equal(statusCode, 401);
        httpErrors.push({ path, statusCode });
        updater.autoUpdater.emit("error", error as Error);
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(httpErrors.length, 2);
  // Reuse a real verified cache: the installed library logs this unquoted path.
  const cache = new DownloadedUpdateHelper(join(directory, "cache synthetic-cache-dir"));
  const name = "update synthetic-cache-tail.bin", file = join(cache.cacheDirForPendingUpdate, name);
  const contents = Buffer.from("Owned updater cache fixture");
  const info = { url: name, sha512: createHash("sha512").update(contents).digest("base64") };
  const version = { version: "0.3.0", releaseDate: "2026-10-06T00:00:00Z", files: [info] };
  const resolved = { info, url: new URL("https://updates.invalid/fixture.bin") };
  mkdirSync(cache.cacheDirForPendingUpdate, { recursive: true });
  writeFileSync(file, contents);
  await cache.setDownloadedFile(file, null, version, resolved, name, true);
  const reused = await new DownloadedUpdateHelper(cache.cacheDir).validateDownloadedPath(file, version, resolved, updater.autoUpdater.logger!);
  assert.equal(reused, file);
  return { filesystemErrors, httpErrors, cacheReused: true };
}
