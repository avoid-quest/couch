import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
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
if (providersArgument !== -1 && !providersConfig) throw new Error("Supply a JSON file after --providers");
if (providersConfig && providerCatalogs) throw new Error("Use either --providers or --provider-catalogs");
if (autoJellyfin && jellyfinConfig) throw new Error("Use either --jellyfin or --jellyfin-config");

async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command[0]} ${command[1]} exited with ${code}`);
}

await mkdir(artifacts, { recursive: true });
if (!providersConfig && !providerCatalogs) for (const name of ["results.json", "failure.txt", "diagnostics.json", "native-failure.png"]) await rm(resolve(artifacts, name), { force: true });
await run(["docker", "info", "--format", "Docker {{.ServerVersion}} / {{.Architecture}}"]);
await run(["docker", "build", "--progress", "plain", "-t", image, "tests/linux"]);
const fixture = autoJellyfin ? await startJellyfinFixture({ root, image, artifacts }) : null;
const config = fixture?.configPath ?? jellyfinConfig;
try { await run([
  "docker", "run", "--rm", "--init", "--shm-size=1g",
  "--mount", `type=bind,source=${root},target=/source,readonly`,
  "--mount", `type=bind,source=${artifacts},target=/artifacts`,
  "--mount", "type=volume,source=couch-linux-target,target=/cache/target",
  "--mount", "type=volume,source=couch-linux-registry,target=/root/.cargo/registry",
  "--mount", "type=volume,source=couch-linux-bun,target=/root/.bun/install/cache",
  ...(config ? ["--mount", `type=bind,source=${resolve(config)},target=/jellyfin-test.json,readonly`, "--env", "COUCH_TEST_JELLYFIN=/jellyfin-test.json"] : []),
  ...(fixture ? ["--network", fixture.dockerNetwork] : []),
  ...(providersConfig ? ["--mount", `type=bind,source=${resolve(providersConfig)},target=/providers.json,readonly`, "--env", "COUCH_TEST_PROVIDERS=/providers.json"] : []),
  ...(providerCatalogs ? ["--env", "COUCH_TEST_PROVIDER_CATALOGS=1"] : []),
  ...(process.argv.includes("--live-radio") ? ["--env", "COUCH_TEST_LIVE_RADIO=1"] : []),
  image,
]); } finally { await fixture?.close(); }
console.log(`Linux test artifacts: ${artifacts}`);
