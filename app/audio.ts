import type { CommandLine } from "electron";

// Chromium's Linux Pulse backend otherwise captures in 1,024-frame blocks.
// Keep an explicit Chromium switch (including 0 for its defaults) authoritative.
export function configureAudioBuffers(commandLine: Pick<CommandLine, "hasSwitch" | "appendSwitch">, platform = process.platform) {
  if (platform === "linux" && !commandLine.hasSwitch("audio-buffer-size")) commandLine.appendSwitch("audio-buffer-size", "128");
}
