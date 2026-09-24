// Inert act control-flow checks. macOS compilation and hosted secrets need their real runners.
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const [actInput, outputInput] = process.argv.slice(2);
assert.ok(actInput && outputInput, "Supply act and a disposable output directory.");
const act = resolve(actInput), output = resolve(outputInput);
const dockerHost = process.env.DOCKER_HOST ?? Bun.spawnSync(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { stderr: "inherit" }).stdout.toString().trim();
assert.ok(dockerHost);
const image = process.env.COUCH_ACT_IMAGE ?? "catthehacker/ubuntu:full-latest";
const architecture = process.env.COUCH_ACT_ARCH ?? `linux/${process.arch === "arm64" ? "arm64" : "amd64"}`;
await mkdir(`${output}/home`, { recursive: true });
await mkdir(`${output}/workspace`, { recursive: true });

const cases = [
  { name: "desktop-dmg", file: "package-desktop", job: "package", inputs: { format: "dmg" }, want: ["Build and verify the native package", "Seal the verified native bytes and signed receipts", "Upload only the qualified bytes to the Debian Preview draft"] },
  { name: "desktop-nsis", file: "package-desktop", job: "package", inputs: { format: "nsis" }, want: ["Build and verify the native package", "Seal the verified native bytes and signed receipts", "Upload only the qualified bytes to the Debian Preview draft"] },
  { name: "desktop-disabled", file: "package-desktop", job: "package", inputs: { format: "dmg" }, enabled: false, want: [] },
  { name: "desktop-branch", file: "package-desktop", job: "package", inputs: { format: "dmg" }, ref: "refs/heads/feature", want: [] },
  { name: "desktop-build-fails", file: "package-desktop", job: "package", inputs: { format: "dmg" }, fault: "Build and verify the native package", fail: true, want: ["Build and verify the native package"] },
  { name: "publisher", file: "publish-preview", job: "publish", inputs: {}, want: ["Verify the assembled draft or published release", "Publish all six qualified Preview assets together", "Check public downloads, updater feeds and GitHub mirror"] },
  { name: "publisher-readiness", file: "publish-preview", job: "publish", inputs: { "readiness-only": true }, want: ["Verify the assembled draft or published release", "Check public downloads, updater feeds and GitHub mirror"] },
  { name: "publisher-disabled", file: "publish-preview", job: "publish", inputs: {}, enabled: false, want: [] },
  { name: "publisher-branch", file: "publish-preview", job: "publish", inputs: {}, ref: "refs/heads/feature", want: [] },
  { name: "publisher-verify-fails", file: "publish-preview", job: "publish", inputs: {}, fault: "Verify the assembled draft or published release", fail: true, want: ["Verify the assembled draft or published release"] },
  { name: "publisher-publish-fails", file: "publish-preview", job: "publish", inputs: {}, fault: "Publish all six qualified Preview assets together", fail: true, want: ["Verify the assembled draft or published release", "Publish all six qualified Preview assets together"] },
] as const;

const observedNames = ["Build and verify the native package", "Seal the verified native bytes and signed receipts", "Upload only the qualified bytes to the Debian Preview draft", "Verify the assembled draft or published release", "Publish all six qualified Preview assets together", "Check public downloads, updater feeds and GitHub mirror"];
const results = [];
for (const scenario of cases) {
  const source = await Bun.file(`.github/workflows/${scenario.file}.yml`).text();
  const mock = Bun.YAML.parse(source) as any;
  mock.name = scenario.name;
  const job = mock.jobs[scenario.job];
  delete job.environment;
  job.steps = job.steps.map((step: any) => {
    const name = step.name ?? step.uses;
    const replacement: any = { name, run: `printf '%s\\n' ${JSON.stringify(`STEP:${name}`)}` };
    for (const key of ["if", "id", "env", "continue-on-error"]) if (key in step) replacement[key] = step[key];
    if (scenario.fault === name) replacement.run += "\nexit 17";
    return replacement;
  });
  const path = `${output}/workspace/${scenario.name}`;
  await Bun.write(`${path}.yml`, Bun.YAML.stringify(mock, null, 2));
  const baseline = scenario.file === "package-desktop"
    ? { format: "dmg", "deb-run": 1, "deb-attempt": 1, "release-id": "AAAAAAAAAAAAAAAAAAAAAAAAAA" }
    : { "source-revision": "9434f32c8dfaf6ebb1f824761527f95487c8381a", "deb-run": 1, "deb-attempt": 1, "appimage-run": 2, "appimage-attempt": 1, "dmg-run": 3, "dmg-attempt": 1, "nsis-run": 4, "nsis-attempt": 1, "release-id": "AAAAAAAAAAAAAAAAAAAAAAAAAA", "readiness-only": false };
  await Bun.write(`${path}.json`, JSON.stringify({ ref: scenario.ref ?? "refs/heads/main", repository: { full_name: "avoid-quest/couch", default_branch: "main" }, inputs: Object.fromEntries(Object.entries({ ...baseline, ...scenario.inputs }).map(([key, value]) => [key, String(value)])) }));
  const command = [act, "workflow_dispatch", "-C", `${output}/workspace`, "-W", `${path}.yml`, "-e", `${path}.json`, "--env-file", "/dev/null", "--secret-file", "/dev/null", "--var-file", "/dev/null", "--input-file", "/dev/null", "--platform", `${scenario.file === "package-desktop" ? "macos-26" : "blacksmith-4vcpu-ubuntu-2404"}=${image}`, "--container-architecture", architecture, "--pull=false", "--network", "none", "--container-daemon-socket", "-", "--no-cache-server", "--rm", "--var", `COUCH_RELEASES_ENABLED=${scenario.enabled !== false}`, "--action-cache-path", `${output}/action-cache`];
  const child = Bun.spawn(command, { env: { PATH: process.env.PATH!, HOME: `${output}/home`, DOCKER_HOST: dockerHost }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const log = stdout + stderr;
  await Bun.write(`${path}.log`, log);
  const observed = observedNames.filter(name => log.includes(`| STEP:${name}`)).sort();
  const expected = [...scenario.want].sort();
  const pass = code === (scenario.fail ? 1 : 0) && JSON.stringify(observed) === JSON.stringify(expected);
  results.push({ name: scenario.name, pass, code, observed, expected });
  console.log(`${pass ? "PASS" : "FAIL"} ${scenario.name}`);
}
await Bun.write(`${output}/results.json`, JSON.stringify({ limits: "Inert steps on Linux. Does not prove macOS compilation, provider behavior or secrets.", cases: results }, null, 2) + "\n");
assert.ok(results.every(result => result.pass), "Inspect failed act scenarios.");
