import { existsSync } from "node:fs";
import { Agent } from "node:https";
import type { WebContents } from "electron";
import { audioPeerTls } from "./audio-peer";
import { nativeAudioOutput } from "./native-audio-output";
import { nativeOutputBufferOptions, type NativeOutputAction } from "../src/shared/native-output";

/** Playback belongs to one main frame and one server-selected receiver generation. */
export function createLiveOutput(ownerOf: () => WebContents | null, originOf: () => string | null,
  pinOf: (hostname: string) => string | undefined, localOrigin: string, helper?: string) {
  let active: { id: string; stop(): Promise<void> } | undefined;
  let pendingId: string | undefined;
  let generation = 0, retiring = Promise.resolve();
  const stop = () => { generation++; pendingId = undefined; return active?.stop() ?? retiring; };
  return {
    stop,
    available: () => !!helper && existsSync(helper),
    async action(value: unknown) {
      const action = value as NativeOutputAction;
      if (!action || typeof action !== "object" || !["start", "stop"].includes(action.op)
        || typeof action.receiverId !== "string" || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(action.receiverId))
        throw new Error("Invalid native output request.");
      if (action.op === "stop") { if (active?.id === action.receiverId || pendingId === action.receiverId) await stop(); return; }
      if (!helper || !existsSync(helper)) throw new Error("Native audio output is not available in this app.");
      if (typeof action.clientId !== "string" || !/^[\w-]{43}$/.test(action.clientId)
        || typeof action.privateKey !== "string" || !/^[\w-]{43}$/.test(action.privateKey)
        || typeof action.name !== "string" || !action.name.trim() || action.name.length > 100
        || !nativeOutputBufferOptions.some(ms => Number(ms) === action.bufferMs)) throw new Error("Invalid native audio settings.");
      const owner = ownerOf(), frame = owner?.mainFrame, origin = originOf();
      if (!owner || owner.isDestroyed() || !frame || !origin || new URL(frame.url).origin !== origin)
        throw new Error("Use this window's current Couch for native audio.");
      const ownerUrl = frame.url, pin = pinOf(new URL(origin).hostname);
      const request = ++generation;
      pendingId = action.receiverId;
      await (active?.stop() ?? retiring);
      const current = () => generation === request && ownerOf() === owner && !owner.isDestroyed()
        && owner.mainFrame === frame && !frame.detached && frame.url === ownerUrl && originOf() === origin
        && pinOf(new URL(origin).hostname) === pin;
      if (!current()) throw new Error("Native audio was canceled.");
      const lifetime = new AbortController();
      let output: ReturnType<typeof nativeAudioOutput> | undefined, agent: Agent | undefined, closed = false, closing = Promise.resolve();
      const navigation = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => { if (main) void state.stop(); };
      const gone = () => { void state.stop(); };
      const state = {
        id: action.receiverId,
        stop() {
          if (closed) return closing;
          closed = true; lifetime.abort();
          if (active === state) active = undefined;
          owner.removeListener("did-start-navigation", navigation); owner.removeListener("destroyed", gone); owner.removeListener("render-process-gone", gone);
          closing = (output?.stop() ?? Promise.resolve()).finally(() => agent?.destroy());
          retiring = closing;
          return closing;
        },
      };
      active = state;
      owner.on("did-start-navigation", navigation); owner.on("destroyed", gone); owner.on("render-process-gone", gone);
      try {
        const tls = origin === localOrigin ? {} : await audioPeerTls(origin, pin, lifetime.signal);
        if (closed || !current()) throw new Error("Native audio was canceled.");
        if (origin !== localOrigin) agent = new Agent(tls);
        output = nativeAudioOutput(helper, origin, action, agent ? { agent } : {}, error => {
          if (!closed && current()) owner.send("couch:live-output-error", { receiverId: action.receiverId, error });
          void state.stop();
        }, event => {
          // Keep per-packet diagnostics out of normal app logs, and never log identity credentials.
          if (["prepared", "closed"].includes(String(event.event))) console.info("Native Live output", JSON.stringify(event));
        });
        await output.ready;
        if (closed || !current()) throw new Error("Native audio was canceled.");
        pendingId = undefined;
      } catch (error) { await state.stop(); throw error; }
    },
  };
}
