// Local act control-flow checks. Every provider/build action is inert; no release credentials are used.
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const [actInput, outputInput] = process.argv.slice(2);
assert.ok(actInput && outputInput, "Supply the act binary and disposable output directory");
const act = resolve(actInput), output = resolve(outputInput);
const dockerHost = process.env.DOCKER_HOST ?? Bun.spawnSync(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { stderr: "inherit" }).stdout.toString().trim();
assert.ok(dockerHost, "Select an available Docker context or set DOCKER_HOST");
const image = process.env.COUCH_ACT_IMAGE ?? "catthehacker/ubuntu:full-latest";
const architecture = process.env.COUCH_ACT_ARCH ?? `linux/${process.arch === "arm64" ? "arm64" : "amd64"}`;
const source = await Bun.file(".github/workflows/package.yml").text();
const workflow = Bun.YAML.parse(source) as any;
const release = Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text()) as any;
assert.equal(release.on.push, undefined, "The coordinated Preview gate must not dispatch from a merge.");
const names = {
  build: "Build and sign the selected package",
  qualify: "Qualify the exact signed bytes",
  sign: "Sign the qualification receipt",
  restore: "Restore the exact published Preview for Stable",
  upload: "Upload only qualified files directly to CrabNebula",
  publish: "Publish the complete qualified release",
  readiness: "Verify public downloads and updater metadata",
  receipts: "Retain receipts without blocking publication on artifact quota",
  logs: "Restore signed receipts from the original run log when artifact storage was unavailable",
};
const cases = [
  { name: "native-draft", inputs: {}, want: ["build", "qualify", "sign", "upload"] },
  { name: "appimage-draft", inputs: { format: "appimage" }, want: ["build", "qualify", "sign", "upload"] },
  { name: "appimage-attach", inputs: { format: "appimage", "release-id": "AAAAAAAAAAAAAAAAAAAAAAAAAA" }, want: ["build", "qualify", "sign", "upload"] },
  { name: "reject-appimage-publish", inputs: { format: "appimage", publish: true }, want: [], fail: true },
  { name: "reject-appimage-stable", inputs: { format: "appimage", channel: "stable", "build-run": 123 }, want: [], fail: true },
  { name: "native-publish", inputs: { publish: true }, want: ["build", "qualify", "sign", "upload", "publish", "readiness"] },
  { name: "completed-draft-retry", inputs: { "build-run": 123, publish: true }, want: ["publish", "readiness"] },
  { name: "receipt-log-fallback", inputs: { "build-run": 123, publish: true }, fault: "Download retained receipts", want: ["logs", "publish", "readiness"] },
  { name: "stable-promotion", inputs: { "build-run": 123, channel: "stable", publish: true }, want: ["restore", "upload", "publish", "readiness"] },
  { name: "readiness-only", inputs: { "build-run": 123, "readiness-only": true }, want: ["readiness"] },
  { name: "reject-fresh-stable", inputs: { channel: "stable" }, want: [], fail: true },
  { name: "reject-fresh-readiness", inputs: { "readiness-only": true }, want: [], fail: true },
  { name: "branch-guard", inputs: {}, ref: "refs/heads/feature", want: [] },
  { name: "disabled-guard", inputs: {}, enabled: false, want: [] },
  { name: "builder-fails", inputs: { publish: true }, fault: "Prepare the pinned Debian builder", want: [], fail: true },
  { name: "qualification-fails", inputs: { publish: true }, fault: names.qualify, want: ["build", "qualify"], fail: true },
  { name: "signing-fails", inputs: { publish: true }, fault: names.sign, want: ["build", "qualify", "sign"], fail: true },
  { name: "upload-fails", inputs: { publish: true }, fault: names.upload, want: ["build", "qualify", "sign", "upload"], fail: true },
  { name: "publish-fails", inputs: { publish: true }, fault: names.publish, want: ["build", "qualify", "sign", "upload", "publish"], fail: true },
  { name: "receipt-quota-nonblocking", inputs: { publish: true }, fault: names.receipts, want: ["build", "qualify", "sign", "upload", "publish", "readiness"] },
] as const;
assert.deepEqual(Object.keys(workflow.jobs), ["release"]);
const receiptStep = workflow.jobs.release.steps.find((step: any) => step.name === names.receipts);
assert.equal(receiptStep["continue-on-error"], true);
assert.ok(!receiptStep.with.path.includes("public") && !receiptStep.with.path.includes("inventory"));
assert.equal(workflow.jobs.release.environment, "couch-release");
assert.equal(workflow.on.workflow_dispatch.inputs.notes, undefined);
const candidate = workflow.jobs.release.steps.find((step: any) => step.name === "Check the candidate inputs");
assert.match(candidate.run, /release-notes\.ts "\$revision"/);
const appimageGuard = candidate.run.match(/^\s*if \[ "\$FORMAT" = appimage \]; then[^\n]*$/m)?.[0];
assert.ok(appimageGuard, "Exercise the real AppImage input guard in act");
assert.doesNotMatch(release.jobs.trigger.steps.find((step: any) => step.name === "Dispatch the package pipeline when the version is unreleased").run, /release-notes|notes=/);
assert.match(release.jobs.trigger.steps.find((step: any) => step.name === "Dispatch the package pipeline when the version is unreleased").run, /-f publish=false/);
assert.match(workflow.jobs.release.steps.find((step: any) => step.id === "draft").env.RELEASE_ID, /inputs\.release-id/);
await mkdir(`${output}/home`, { recursive: true });
await mkdir(`${output}/workspace`, { recursive: true });
const results = [];
for (const test of cases) {
  const scenario = test as { name: string; inputs: Record<string, unknown>; want: readonly string[]; fault?: string; fail?: boolean; ref?: string; enabled?: boolean };
  const mock = structuredClone(workflow);
  mock.name = `CouchNativeRelease-${test.name}`;
  const job = mock.jobs.release;
  delete job.environment;
  job.steps = job.steps.map((step: any) => {
    const replacement: any = { name: step.name ?? step.uses, run: `printf '%s\\n' ${JSON.stringify(`STEP:${step.name ?? step.uses}`)}` };
    for (const key of ["if", "id", "env", "continue-on-error"]) if (key in step) replacement[key] = step[key];
    if (step.name === "Check the candidate inputs") replacement.run += `\n${appimageGuard}\nif [ "$BUILD_RUN" = 0 ]; then test "$CHANNEL" = preview && test "$READINESS_ONLY" = false; fi`;
    if (step.id === "draft") replacement.run += '\necho "release-id=AAAAAAAAAAAAAAAAAAAAAAAAAA" >> "$GITHUB_OUTPUT"';
    if (scenario.fault && step.name === scenario.fault) replacement.run += "\nexit 17";
    return replacement;
  });
  const path = `${output}/workspace/${test.name}`;
  await Bun.write(`${path}.yml`, Bun.YAML.stringify(mock, null, 2));
  await Bun.write(`${path}.json`, JSON.stringify({ ref: scenario.ref ?? "refs/heads/main", repository: { full_name: "avoid-quest/couch", default_branch: "main" }, inputs: Object.fromEntries(Object.entries(test.inputs).map(([key, value]) => [key, String(value)])) }));
  const command = [act, "workflow_dispatch", "-C", `${output}/workspace`, "-W", `${path}.yml`, "-e", `${path}.json`, "--env-file", "/dev/null", "--secret-file", "/dev/null", "--var-file", "/dev/null", "--input-file", "/dev/null", "--platform", `blacksmith-4vcpu-ubuntu-2404=${image}`, "--container-architecture", architecture, "--pull=false", "--network", "none", "--container-daemon-socket", "-", "--no-cache-server", "--rm", "--var", `COUCH_RELEASES_ENABLED=${scenario.enabled !== false}`, "--action-cache-path", `${output}/action-cache`];
  const start = performance.now();
  const child = Bun.spawn(command, { env: { PATH: process.env.PATH!, HOME: `${output}/home`, DOCKER_HOST: dockerHost }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const log = stdout + stderr;
  await Bun.write(`${path}.log`, log);
  const observed = Object.entries(names).filter(([key, name]) => key !== "receipts" && log.includes(`| STEP:${name}`)).map(([key]) => key).sort();
  const expected = [...scenario.want].sort();
  const candidateReached = log.includes("| STEP:Check the candidate inputs");
  const pass = code === (scenario.fail ? 1 : 0) && JSON.stringify(observed) === JSON.stringify(expected)
    && (!scenario.name.startsWith("reject-appimage-") || candidateReached);
  results.push({ name: test.name, pass, exit: code, candidateReached, observed, expected, seconds: Number(((performance.now() - start) / 1000).toFixed(3)) });
  console.log(`${pass ? "PASS" : "FAIL"} ${test.name}`);
}
await Bun.write(`${output}/results.json`, JSON.stringify({ workflowSha256: new Bun.CryptoHasher("sha256").update(source).digest("hex"), limits: "Inert action/build/provider replacements. No signing, compilation, package installation, permissions, artifact transport or CDN verification is established.", cases: results }, null, 2) + "\n");
assert.ok(results.every(result => result.pass), "Inspect failed act scenarios");
