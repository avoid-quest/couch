import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startJellyfinFixture } from "../tests/linux/jellyfin-fixture";

const root = resolve(import.meta.dir, "..");
const artifacts = resolve(root, ".artifacts/linux");
const image = "couch-linux-test:ubuntu24.04";
const configArgument = process.argv.indexOf("--jellyfin-config");
const jellyfinConfig = configArgument === -1 ? null : process.argv[configArgument + 1];
if (configArgument !== -1 && !jellyfinConfig) throw new Error("Supply a JSON file after --jellyfin-config");
const autoJellyfin = process.argv.includes("--jellyfin");
const providersArgument = process.argv.indexOf("--providers");
const providersConfig = providersArgument === -1 ? null : process.argv[providersArgument + 1];
const providerCatalogs = process.argv.includes("--provider-catalogs");
const builtRemote = process.argv.includes("--built-remote");
const diagnostics = process.argv.includes("--diagnostics");
if (providersArgument !== -1 && !providersConfig) throw new Error("Supply a JSON file after --providers");
if (providersConfig && providerCatalogs) throw new Error("Use either --providers or --provider-catalogs");
if (autoJellyfin && jellyfinConfig) throw new Error("Use either --jellyfin or --jellyfin-config");
if (builtRemote && (providersConfig || providerCatalogs || autoJellyfin || jellyfinConfig || process.argv.includes("--live-radio") || diagnostics)) throw new Error("Use --built-remote alone for the deterministic sidecar/browser journey.");
if (diagnostics && (providersConfig || providerCatalogs || autoJellyfin || jellyfinConfig || process.argv.includes("--live-radio"))) throw new Error("Use --diagnostics alone for the focused native claim journey.");

async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command[0]} ${command[1]} exited with ${code}`);
}
const git = (...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.toString().trim();
};
if (git("status", "--porcelain")) throw new Error("Commit the tested changes before Linux qualification. Use preview:linux for an uncommitted visual preview.");
const revision = git("rev-parse", "HEAD");
await mkdir(artifacts, { recursive: true });
if (!providersConfig && !providerCatalogs) for (const name of ["results.json", "failure.txt", "diagnostics.json", "native-failure.png"]) await rm(resolve(artifacts, name), { force: true });
await run(["docker", "info", "--format", "Docker {{.ServerVersion}} / {{.Architecture}}"]);
await run(["docker", "build", "--progress", "plain", "-t", image, "tests/linux"]);
const snapshot = await mkdtemp(join(tmpdir(), "couch-linux-source-"));
let fixture: Awaited<ReturnType<typeof startJellyfinFixture>> | null = null;
try {
  // A full immutable checkout includes workspaces, Vite config, every test and
  // the real Git identity. Do not qualify a hand-maintained partial tar copy.
  await run(["git", "bundle", "create", join(snapshot, "source.bundle"), "HEAD"]);
  if (git("rev-parse", "HEAD") !== revision || git("status", "--porcelain")) throw new Error("The source changed while preparing Linux qualification.");
  fixture = autoJellyfin ? await startJellyfinFixture({ root, image, artifacts }) : null;
  const config = fixture?.configPath ?? jellyfinConfig;
  await run([
    "docker", "run", "--rm", "--init", "--shm-size=1g",
    "--mount", `type=bind,source=${join(snapshot, "source.bundle")},target=/source.bundle,readonly`,
    "--env", `COUCH_SOURCE_REVISION=${revision}`,
    "--mount", `type=bind,source=${artifacts},target=/artifacts`,
    "--mount", "type=volume,source=couch-linux-target,target=/cache/target",
    "--mount", "type=volume,source=couch-linux-registry,target=/root/.cargo/registry",
    "--mount", "type=volume,source=couch-linux-bun,target=/root/.bun/install/cache",
    ...(builtRemote ? ["--env", "COUCH_TEST_BUILT_REMOTE=1"] : []),
    ...(diagnostics ? ["--env", "COUCH_TEST_DIAGNOSTICS=1"] : []),
    ...(config ? ["--mount", `type=bind,source=${resolve(config)},target=/jellyfin-test.json,readonly`, "--env", "COUCH_TEST_JELLYFIN=/jellyfin-test.json"] : []),
    ...(fixture ? ["--network", fixture.dockerNetwork] : []),
    ...(providersConfig ? ["--mount", `type=bind,source=${resolve(providersConfig)},target=/providers.json,readonly`, "--env", "COUCH_TEST_PROVIDERS=/providers.json"] : []),
    ...(providerCatalogs ? ["--env", "COUCH_TEST_PROVIDER_CATALOGS=1"] : []),
    ...(process.argv.includes("--live-radio") ? ["--env", "COUCH_TEST_LIVE_RADIO=1"] : []),
    image, "bash", "-ec", 'git clone --no-checkout /source.bundle /work; git -C /work checkout --detach "$COUCH_SOURCE_REVISION"; exec bash /work/tests/linux/run.sh',
  ]);
} finally { await fixture?.close(); await rm(snapshot, { recursive: true, force: true }); }
console.log(`Linux test artifacts for ${revision}: ${artifacts}`);
