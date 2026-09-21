import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

type Source = { revision: string; dirty: boolean };
export function verificationPlan(args: string[]): string[][] {
  for (const arg of args) if (arg !== "--native" && arg !== "--remote") throw new Error(`Unknown verification option: ${arg}`);
  const commands = [["bun", "run", "check"], ["bun", "run", "build"]];
  if (args.includes("--native")) commands.push(
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"],
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "-p", "tauri-plugin-video", "startup_buffer"],
  );
  if (args.includes("--remote")) commands.push(["bun", "tests/linux/built-remote.ts"]);
  return commands;
}
export function verificationOutcome(before: Source, after: Source, exits: number[], expected: number) {
  const passed = expected > 0 && exits.length === expected && exits.every(code => code === 0);
  return { passed, eligible: passed && !before.dirty && !after.dirty && before.revision === after.revision };
}

async function main() {
  const root = resolve(import.meta.dir, "..");
  const artifacts = resolve(process.env.COUCH_VERIFICATION_ARTIFACTS ?? resolve(root, ".artifacts"));
  await mkdir(artifacts, { recursive: true });
  // Invalidate older evidence before argument parsing or Git/tooling preflight.
  // A failed or interrupted attempt must not leave an earlier green receipt.
  await rm(resolve(artifacts, "verification.json"), { force: true });
  const commands = verificationPlan(process.argv.slice(2));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: root });
    if (result.exitCode !== 0) throw new Error(`Cannot read verification source: git ${args.join(" ")}`);
    return result.stdout.toString().trim();
  };
  const source = (): Source => ({ revision: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain") !== "" });
  const before = source();
  const startedAt = new Date().toISOString();
  const steps: Array<{ command: string[]; startedAt: string; finishedAt: string; milliseconds: number; exitCode: number }> = [];
  let error: string | null = null;
  let after = before;
  try {
    const { packageManager } = await Bun.file(resolve(root, "package.json")).json();
    if (`bun@${Bun.version}` !== packageManager) throw new Error(`Use ${packageManager} for qualification; running bun@${Bun.version}`);
    if (before.dirty) throw new Error("Commit the tested changes first. Use bun run check for uncommitted local iteration.");
    for (const tool of process.platform === "linux" ? ["ffmpeg", "minisign", "getfacl", "jq"] : ["ffmpeg"]) {
      if (!Bun.which(tool)) throw new Error(`Missing qualification dependency: ${tool}. Do not treat skipped container checks as a passing gate.`);
    }
    for (const command of commands) {
      const start = Date.now();
      const child = Bun.spawn(command, { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      let cancelled = false;
      const cancel = () => { cancelled = true; child.kill(); };
      process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
      let exitCode: number;
      try { exitCode = await child.exited; }
      finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
      if (cancelled && exitCode === 0) exitCode = 1;
      steps.push({ command, startedAt: new Date(start).toISOString(), finishedAt: new Date().toISOString(), milliseconds: Date.now() - start, exitCode });
      if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with ${exitCode}`);
    }
  } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  try { after = source(); } catch (reason) { error ??= String(reason); }
  const outcome = verificationOutcome(before, after, steps.map(step => step.exitCode), commands.length);
  const eligible = !error && outcome.eligible;
  await Bun.write(resolve(artifacts, "verification.json"), JSON.stringify({
    schema: 1, before, after, startedAt, finishedAt: new Date().toISOString(),
    bun: Bun.version, platform: process.platform, architecture: process.arch,
    hosted: process.env.GITHUB_RUN_ID ? { run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, ref: process.env.GITHUB_REF } : null,
    coverage: { core: steps[0]?.exitCode === 0, build: steps[1]?.exitCode === 0,
      nativeUnit: commands.some(command => command[0] === "cargo") && steps.filter(step => step.command[0] === "cargo" && step.exitCode === 0).length === 2,
      builtRemote: steps.some(step => step.command[1] === "tests/linux/built-remote.ts" && step.exitCode === 0), hardware: false },
    steps, passed: !error && outcome.passed, eligible, error,
  }, null, 2));
  if (!eligible) { console.error(error ?? "The source changed during verification; this receipt cannot qualify the PR."); process.exitCode = 1; }
  else console.log(`Verified ${before.revision}; receipt: ${resolve(artifacts, "verification.json")}. Hardware verification is separate.`);
}
if (import.meta.main) await main();
