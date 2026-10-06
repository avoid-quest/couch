// Bundled by app-diagnostics.native.ts, then run inside the real Electron Main.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import updater from "electron-updater";
import { startUpdates } from "../app/update";

export async function exerciseUpdater(directory: string, port: number) {
  startUpdates({ channelPath: join(directory, "update-channel"), tv: false, onState() {} });
  let filesystemErrors = 0;
  for (const separator of [" ", "\t", "\n", "\u2028"]) {
    try { readFileSync(join(directory, `missing${separator}synthetic-updater-path.txt`)); }
    catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      filesystemErrors++;
      // The installed updater's original error listener supplies its real stack.
      updater.autoUpdater.emit("error", error as Error);
    }
  }
  assert.equal(filesystemErrors, 4);
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
  return { filesystemErrors, httpErrors };
}
