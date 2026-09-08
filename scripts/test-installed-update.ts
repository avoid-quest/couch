// Reuse qualified local bytes and the production publisher with a disposable key.
import { strict as assert } from "node:assert";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { publish } from "./publish-appimage";

const [appimage, qualified, directory] = process.argv.slice(2);
assert.ok(process.argv.length === 5 && appimage && qualified && directory, "Usage: bun scripts/test-installed-update.ts APPIMAGE QUALIFIED_B_DIRECTORY EVIDENCE_DIRECTORY");
assert.ok(await Bun.file(appimage).exists(), "Installed A AppImage must exist");
const target = resolve(qualified);
const evidence = resolve(directory);
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "couch-installed-update-"));
const feed = join(temporary, "feed"), key = join(temporary, "signer.key");
delete process.env.TAURI_SIGNING_PRIVATE_KEY;
process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = key;
process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
async function run(args: string[], quiet = false, env = process.env) {
  const child = Bun.spawn(args, { stdout: quiet ? "ignore" : "inherit", stderr: quiet ? "ignore" : "inherit", env });
  assert.equal(await child.exited, 0, `${args[0]} failed`);
}
let server: ReturnType<typeof Bun.serve> | undefined;
let activeEvidence = evidence;
try {
  await run(["bunx", "--no-install", "tauri", "signer", "generate", "--ci", "-p", "", "-w", key], true);
  await chmod(key, 0o600);
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = resolve(feed, `.${decodeURIComponent(new URL(request.url).pathname)}`);
    if (!path.startsWith(`${feed}${sep}`)) return new Response(null, { status: 404 });
    const file = Bun.file(path);
    if (process.env.COUCH_QUALIFY_RECOVERY_FAULTS === "1" || process.env.COUCH_QUALIFY_IDLE_UPDATES === "1") {
      const fault = await Bun.file(join(activeEvidence, "feed-fault")).text().catch(() => "");
      if (fault === "offline") return new Response(null, { status: 503 });
      if (fault === "bad-signature" && path.endsWith(".sig")) return new Response("invalid qualification signature");
      if (fault === "interrupted-download" && path.endsWith(".AppImage") && await file.exists()) {
        return new Response(new ReadableStream({ async start(controller) {
          controller.enqueue(new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
          setTimeout(() => controller.error(new Error("qualification interrupted download")), 50);
        } }), { headers: { "Content-Length": String(file.size) } });
      }
    }
    return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
  } });
  const endpoint = `http://127.0.0.1:${server.port}/`;
  // Publication retains releases/BUILD.ATTEMPT/release.json and its signed archive
  // alongside Preview, so the installed B can request its exact-current repair.
  const release = await publish(target, feed, endpoint, "preview", "Disposable installed update qualification");
  await rm(key);
  delete process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  const file = [...new Bun.Glob("*.AppImage").scanSync(target)][0]!;
  const archiveSha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(join(target, file)).arrayBuffer()).digest("hex");
  const trust = { endpoint, pubkey: (await Bun.file(`${key}.pub`).text()).trim() };
  for (const scenario of process.env.COUCH_QUALIFY_IDLE_UPDATES === "1" ? ["success", "failure"] : [""]) {
    activeEvidence = scenario ? join(evidence, `idle-${scenario}`) : evidence;
    await mkdir(activeEvidence, { recursive: true });
    const receipt = join(activeEvidence, "update-target.json");
    await Bun.write(receipt, JSON.stringify({ version: release.version, revision: release.revision, archiveSha256 }));
    await Bun.write(join(activeEvidence, "appimage-update.json"), JSON.stringify(trust));
    await run(["bash", "scripts/test-appliance-systemd.sh", "--appimage", resolve(appimage), activeEvidence], false, { ...process.env, COUCH_QUALIFY_UPDATE_RECEIPT: receipt, COUCH_QUALIFY_IDLE_SCENARIO: scenario });
  }
} finally {
  server?.stop(true);
  await rm(temporary, { recursive: true, force: true });
}
