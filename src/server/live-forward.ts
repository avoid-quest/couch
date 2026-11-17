import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { LiveSignalMessage } from "../shared/live-input";

type Signal = LiveSignalMessage["signal"];
type Ice = { urls: string[]; username?: string; credential?: string };
type Helper = { child: ChildProcessByStdio<Writable, Readable, null>; peers: Set<string> };

/**
 * The relay helper's forwarding job: the sharer's one connection (uplink) to this computer, and one per viewer
 * (downlink), carrying the uplink's packets without decoding them. The helper runs while any of them is open.
 */
export function createForwarder(options: {
  executable?: string;
  iceServers: () => RTCIceServer[];
  signal: (peerId: string, signal: Signal) => void;
  failed: (peerId: string, error: string) => void;
}) {
  let helper: Helper | undefined,
    unavailable = !options.executable || !existsSync(options.executable);
  const ice = (): Ice[] =>
    options.iceServers().map((server) => ({
      urls: [server.urls].flat(),
      ...(server.username ? { username: server.username } : {}),
      ...(typeof server.credential === "string" ? { credential: server.credential } : {}),
    }));
  const start = (): Helper => {
    const child = spawn(options.executable!, ["forward"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const current: Helper = { child, peers: new Set() };
    child.stdin.on("error", () => {});
    child.once("error", () => {
      unavailable = true;
    });
    child.once("close", () => {
      if (helper === current) helper = undefined;
      for (const peerId of current.peers)
        options.failed(peerId, "Couch's forwarding relay stopped.");
      current.peers.clear();
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      let event: { op?: unknown; peer?: unknown; signal?: Signal; error?: unknown };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof event.peer !== "string" || !current.peers.has(event.peer)) return;
      if (event.op === "signal" && event.signal) options.signal(event.peer, event.signal);
      else if (event.op === "failed") {
        current.peers.delete(event.peer);
        options.failed(
          event.peer,
          typeof event.error === "string" ? event.error : "The connection through Couch failed.",
        );
      }
    });
    return current;
  };
  const send = (command: Record<string, unknown> & { peer: string }) => {
    (helper ??= start()).child.stdin.write(`${JSON.stringify(command)}\n`);
  };
  const open = (command: Record<string, unknown> & { peer: string }) => {
    send({ ...command, ice: ice() });
    helper!.peers.add(command.peer);
  };
  return {
    /** False without the bundled helper (a build from source without Go), or once it couldn't launch. */
    available: () => !unavailable,
    uplink(peerId: string, sourceId: string, picture: boolean, sound: boolean) {
      open({ op: "uplink", peer: peerId, source: sourceId, picture, sound });
    },
    downlink(peerId: string, sourceId: string, picture: boolean, sound: boolean) {
      open({ op: "downlink", peer: peerId, source: sourceId, picture, sound });
    },
    signal(peerId: string, signal: Signal) {
      if (helper?.peers.has(peerId)) send({ op: "signal", peer: peerId, signal });
    },
    close(peerId: string) {
      if (!helper?.peers.delete(peerId)) return;
      send({ op: "close", peer: peerId });
      // Nothing shared reaches Couch: let the helper go.
      if (!helper.peers.size) {
        helper.child.stdin.end();
        helper = undefined;
      }
    },
    stop() {
      helper?.child.stdin.end();
    },
  };
}

export type Forwarder = ReturnType<typeof createForwarder>;
