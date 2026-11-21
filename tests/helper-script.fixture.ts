import { spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";

// Windows needs an interpreter to launch a JavaScript fixture. Keep the real child and its stdio.
export function runHelperScript(script: string) {
  const processes: {
    spawn(file: string, args: readonly string[], options: SpawnOptions): ChildProcess;
  } = childProcess;
  const spawn = processes.spawn;
  return spyOn(processes, "spawn").mockImplementation((file, args, options) =>
    file === script
      ? spawn(process.execPath, [script, ...args], options)
      : spawn(file, args, options),
  );
}
