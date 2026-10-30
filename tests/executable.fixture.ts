import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const executableName = (name: string) => name + (process.platform === "win32" && !name.endsWith(".exe") ? ".exe" : "");

// Only JavaScript executable fixtures inside this private directory are redirected.
// Keep real Node children, arguments, stdio, cancellation and helper cache files.
// Self-contained so the identical boundary can be preloaded in the audio worker.
function redirect(directory: string, journal: string, native?: { path: string; target: string; log: string }) {
  const cp = process.getBuiltinModule("node:child_process");
  const fs = process.getBuiltinModule("node:fs");
  const { sep } = process.getBuiltinModule("node:path");
  const { syncBuiltinESMExports } = process.getBuiltinModule("node:module");
  const { promisify } = process.getBuiltinModule("node:util");
  const spawn = cp.spawn, execFile = cp.execFile;
  const argumentsFor = (file: string, args: string[]) => {
    if (file === native?.path) return [native.target, args] as const;
    if (!file.startsWith(directory + sep) || !fs.existsSync(file)) return [file, args] as const;
    const source = fs.readFileSync(file, "utf8");
    if (!source.startsWith(`#!${process.execPath}\n`) && !source.startsWith("#!couch-test-node\n")) return [file, args] as const;
    return [process.execPath, ["--input-type=commonjs", "--eval", source.replace(/^#![^\n]*\n/, ""), "--", file, ...args]] as const;
  };
  const record = (child: import("node:child_process").ChildProcess) => {
    if (child.pid) {
      fs.appendFileSync(journal, JSON.stringify({ pid: child.pid, closed: false }) + "\n");
      child.once("close", () => { if (fs.existsSync(journal)) fs.appendFileSync(journal, JSON.stringify({ pid: child.pid, closed: true }) + "\n"); });
    }
    return child;
  };
  cp.spawn = ((file: string, args: string[], options: import("node:child_process").SpawnOptions) => {
    const [command, argv] = argumentsFor(file, args);
    const child = spawn(command, argv, options);
    if (file === native?.path && !args.includes("-version")) fs.appendFileSync(native.log, `${child.pid}|${options.cwd ?? process.cwd()}|${args.join(" ")}\n`);
    return command !== file ? record(child) : child;
  }) as typeof cp.spawn;
  cp.execFile = ((file: string, args: string[], ...rest: unknown[]) => {
    const [command, argv] = argumentsFor(file, args);
    const child = Reflect.apply(execFile, cp, [command, argv, ...rest]);
    return command !== file ? record(child) : child;
  }) as typeof cp.execFile;
  Object.defineProperty(cp.execFile, promisify.custom, { value: (file: string, args: string[], options: import("node:child_process").ExecFileOptions) => {
    const [command, argv] = argumentsFor(file, args);
    const promise = promisify(execFile)(command, argv, options);
    if (command !== file) record(promise.child);
    return promise;
  } });
  syncBuiltinESMExports();
  return () => { cp.spawn = spawn; cp.execFile = execFile; syncBuiltinESMExports(); };
}

export function nodeExecutables(directory: string, { workers = false, native }: { workers?: boolean; native?: { path: string; target: string; log: string } } = {}) {
  const journal = join(directory, "fixture-processes.jsonl");
  writeFileSync(journal, "");
  const restore = redirect(directory, journal, native);
  const threads = process.getBuiltinModule("node:worker_threads"), Worker = threads.Worker;
  const runningWorkers = new Set<import("node:worker_threads").Worker>();
  if (workers) {
    const preload = `data:text/javascript,${encodeURIComponent(`(${redirect.toString()})(${JSON.stringify(directory)}, ${JSON.stringify(journal)}, ${JSON.stringify(native)});`)}`;
    threads.Worker = class extends Worker {
      constructor(file: string | URL, options?: import("node:worker_threads").WorkerOptions) {
        super(file, { ...options, execArgv: [...(options?.execArgv ?? []), "--import", preload] });
        runningWorkers.add(this);
        this.once("exit", () => runningWorkers.delete(this));
      }
    };
    process.getBuiltinModule("node:module").syncBuiltinESMExports();
  }
  const active = () => {
    const pids = new Set<number>();
    for (const line of readFileSync(journal, "utf8").trim().split("\n").filter(Boolean)) {
      const { pid, closed } = JSON.parse(line) as { pid: number; closed: boolean };
      if (closed) pids.delete(pid); else pids.add(pid);
    }
    return [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
  };
  let closing: Promise<{ children: number[]; workers: number[] }> | undefined;
  return {
    active,
    close() { return closing ??= (async () => {
      try {
        // Core closes its workers asynchronously. Allow their real cancellation to settle.
        const deadline = Date.now() + 3000;
        while ((active().length || runningWorkers.size) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        // Preserve evidence before either worker termination or the child safety net.
        let children = active();
        if (children.length && !runningWorkers.size && process.platform !== "win32") {
          // A crashed worker can leave exited children unreaped until this test
          // process exits. Record only still-running children as forced cleanup.
          try {
            const states = execFileSync("ps", ["-o", "pid=,ppid=,stat=", "-p", children.join(",")], { encoding: "utf8", timeout: 1000 });
            for (const line of states.trim().split("\n")) {
              const [pid, parent, state] = line.trim().split(/\s+/);
              if (Number(parent) === process.pid && state?.startsWith("Z")) children = children.filter(child => child !== Number(pid));
            }
          } catch { /* Unknown process state remains a cleanup failure. */ }
        }
        const forced = { children, workers: [...runningWorkers].map(worker => worker.threadId) };
        for (const pid of forced.children) { try { process.kill(pid, "SIGKILL"); } catch {} }
        const killed = Date.now() + 1000;
        while (active().length && Date.now() < killed) await new Promise(resolve => setTimeout(resolve, 10));
        await Promise.all([...runningWorkers].map(worker => worker.terminate()));
        return forced;
      } finally {
        restore();
        if (workers) { threads.Worker = Worker; process.getBuiltinModule("node:module").syncBuiltinESMExports(); }
      }
    })(); },
  };
}
