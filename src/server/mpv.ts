import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { helper } from "./helpers";

// Channels Chromium can't decode (MPEG-2 video, AC-3/E-AC-3 or MP2 audio) play in a
// downloaded mpv on the Device that runs Core, driven over its JSON IPC (#644 ticket 1).
// Only Couch drives it, so mpv's own key bindings (arrows seek, q quits) are off.
// https://mpv.io/manual/stable/#json-ipc
export function createMpv(report: (state: PlayerState) => void) {
  const ipc = process.platform === "win32" ? `\\\\.\\pipe\\couch-mpv-${process.pid}` : join(tmpdir(), `couch-mpv-${process.pid}.sock`);
  let child: ChildProcess | null = null;
  let socket: Socket | null = null;
  let volume = 100;
  let state: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume, seekable: false, error: null };
  let loaded = false, paused = false, buffering = false, reportedAt = 0;
  const publish = (changes: Partial<PlayerState>, force = true) => {
    state = { ...state, ...changes, volume };
    if (!force && performance.now() - reportedAt < 1000) return;
    reportedAt = performance.now();
    report(state);
  };
  const status = () => !loaded || buffering ? "loading" : paused ? "paused" : "playing";
  const command = (...args: unknown[]) => socket?.write(`${JSON.stringify({ command: args })}\n`);
  const quit = () => {
    const current = child;
    child = null; socket?.destroy(); socket = null;
    current?.kill();
  };
  const attach = (process: ChildProcess, playbackId: string, attempt = 0) => {
    if (child !== process) return;
    const connection = connect(ipc);
    connection.once("error", () => { if (attempt < 50) setTimeout(() => attach(process, playbackId, attempt + 1), 100); });
    connection.once("connect", () => {
      if (child !== process) { connection.destroy(); return; }
      socket = connection;
      for (const [id, name] of ["time-pos", "duration", "pause", "paused-for-cache", "seekable", "speed"].entries()) command("observe_property", id, name);
      createInterface({ input: connection }).on("line", line => {
        let message: { event?: string; name?: string; data?: unknown; reason?: string; file_error?: string };
        try { message = JSON.parse(line); } catch { return; }
        if (child !== process) return;
        if (message.event === "file-loaded") { loaded = true; publish({ status: status() }); }
        else if (message.event === "end-file" && message.reason !== "stop") publish(message.reason === "eof" ? { status: "ended" } : { status: "error", error: `mpv couldn't play this channel${message.file_error ? ` (${message.file_error})` : ""}.` });
        else if (message.event === "property-change") {
          const { name, data } = message;
          if (name === "time-pos" && typeof data === "number") publish({ position: data }, false);
          else if (name === "duration") publish({ duration: typeof data === "number" ? data : null });
          else if (name === "seekable") publish({ seekable: data === true });
          else if (name === "speed" && typeof data === "number") publish({ speed: data });
          else if (name === "pause") { paused = data === true; publish({ status: status() }); }
          else if (name === "paused-for-cache") { buffering = data === true; publish({ status: status(), buffering }); }
        }
      });
    });
  };
  return {
    send(message: PlaybackCommand) {
      switch (message.type) {
        case "load": {
          quit();
          loaded = false; paused = !!message.paused; buffering = false;
          publish({ playbackId: message.playbackId, status: "loading", position: 0, duration: null, seekable: false, error: null, speed: 1 });
          const { playbackId } = message;
          void helper("mpv").then(path => {
            if (state.playbackId !== playbackId) return;
            const process = spawn(path, [`--input-ipc-server=${ipc}`, "--no-terminal", "--no-input-default-bindings", "--force-window=immediate", "--fullscreen", "--keep-open=no", "--title=Couch", `--volume=${volume}`,
              ...(message.paused ? ["--pause"] : []), ...(message.startPosition ? [`--start=${message.startPosition}`] : []), "--", message.source], { stdio: "ignore" });
            child = process;
            process.once("error", error => { if (child === process) publish({ status: "error", error: `mpv didn't start: ${error.message}` }); });
            process.once("exit", () => { if (child === process) { child = null; publish({ status: "error", error: "The mpv window was closed." }); } });
            attach(process, playbackId);
          }, (error: Error) => { if (state.playbackId === playbackId) publish({ status: "error", error: error.message }); });
          break;
        }
        case "pause": command("set_property", "pause", message.paused); break;
        case "audioPause": command("set_property", "pause", true); break;
        case "seek": command("seek", message.position, "absolute"); break;
        case "speed": command("set_property", "speed", message.speed); break;
        case "volume": volume = message.volume; command("set_property", "volume", volume); publish({}); break;
        case "stop": quit(); publish({ playbackId: null, status: "idle", position: 0, duration: null, seekable: false, error: null }); break;
      }
    },
    close: quit,
  };
}
