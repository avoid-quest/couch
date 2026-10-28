import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from "electron";
import { join } from "node:path";
import type { AudioCaptureFormat, LiveAudioAction } from "../src/shared/capture";
import type { createCapture } from "./capture";
import { nativeAudioInput, nativeAudioInputs } from "./native-audio-input";
import { isNativeChannelMap } from "../src/shared/audio-settings";

/** Owns the microphone independently of renderer progress, including during preparation. */
export function createLiveAudio(ownerOf: () => WebContents | null, capture: ReturnType<typeof createCapture>, localOrigin: string, token: () => string | undefined, nativeHelper?: string) {
  type Active = { id: string; nativeChannels?: number; stop(): Promise<void>; command(action: LiveAudioAction): Promise<AudioCaptureFormat | undefined> };
  let active: Active | undefined;
  let retiring = Promise.resolve();
  let generation = 0;
  const stop = () => { generation++; return active?.stop() ?? retiring; };
  return {
    stop,
    async inputs() {
      const owner = ownerOf(), frame = owner?.mainFrame;
      if (!owner || !frame || owner.isDestroyed() || new URL(frame.url).origin !== localOrigin) throw new Error("Choose native inputs on this computer's Couch.");
      const inputs = await nativeAudioInputs(nativeHelper);
      if (ownerOf() !== owner || owner.isDestroyed() || owner.mainFrame !== frame || frame.detached || new URL(frame.url).origin !== localOrigin) throw new Error("Input selection was canceled.");
      return inputs;
    },
    async action(value: unknown) {
      if (!value || typeof value !== "object") throw new Error("Choose an audio input.");
      const action = value as LiveAudioAction;
      if (typeof action.id !== "string" || !/^[\w-]{1,128}$/.test(action.id)) throw new Error("Invalid audio publication.");
      if (action.op !== "prepare") {
        if (active?.id !== action.id) return;
        if (action.op === "stop") { await stop(); return; }
        if (action.op === "upload") {
          if (typeof action.uploadId !== "string" || !/^[\w-]{1,128}$/.test(action.uploadId) || typeof action.url !== "string") throw new Error("Invalid audio upload.");
          const url = new URL(action.url);
          if (url.origin !== localOrigin.replace(/^http/, "ws") || url.pathname !== "/api/live/upload" || url.username || url.password || url.hash
            || [...url.searchParams.keys()].length !== 4 || ["token", "sourceId", "key", "uploadId"].some(key => url.searchParams.getAll(key).length !== 1)
            || url.searchParams.get("token") !== token() || url.searchParams.get("sourceId") !== action.id || url.searchParams.get("uploadId") !== action.uploadId
            || !/^[a-f0-9]{64}$/.test(url.searchParams.get("key") ?? "")) throw new Error("Use this publication's local audio upload.");
        } else if (action.op === "mute") {
          if (typeof action.muted !== "boolean") throw new Error("Invalid microphone mute.");
        } else if (action.op === "buffer") {
          if (![128, 256, 512, 1024].includes(action.bufferFrames)) throw new Error("Choose a supported native input buffer.");
        } else if (action.op === "channels") {
          if (!isNativeChannelMap(action.channelMap, active.nativeChannels ?? 0)) throw new Error("Choose an available channel or stereo pair for this native input.");
        } else if (action.op !== "stop-upload" || typeof action.uploadId !== "string") throw new Error("Invalid audio command.");
        return active.command(action);
      }
      const owner = ownerOf(), frame = owner?.mainFrame, request = generation;
      if (!owner || !frame || owner.isDestroyed() || new URL(frame.url).origin !== localOrigin) throw new Error("Start Live audio on this computer's Couch.");
      const ownerUrl = frame.url;
      await retiring;
      if (generation !== request || ownerOf() !== owner || owner.isDestroyed() || owner.mainFrame !== frame || frame.detached || frame.url !== ownerUrl) throw new Error("Audio capture was canceled.");
      if (active) throw new Error("Stop sharing before choosing another audio input.");
      if (typeof action.deviceId !== "string" || !action.deviceId || action.deviceId.length > 512) throw new Error("Choose an audio input.");
      if (action.sampleRate !== undefined && ![44100, 48000].includes(action.sampleRate)) throw new Error("Choose a supported Live audio capture rate.");
      if (action.bufferFrames !== undefined && ![128, 256, 512, 1024].includes(action.bufferFrames)) throw new Error("Choose a supported native input buffer.");
      const helperUrl = localOrigin + "/capture-audio.html";
      let helper: BrowserWindow | undefined, helperFrame: typeof frame | undefined, closed = false, nextRequest = 0;
      let native: ReturnType<typeof nativeAudioInput> | undefined, closing = Promise.resolve();
      const lifetime = new AbortController();
      const waiting = new Map<number, { resolve(value?: AudioCaptureFormat): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
      const ensure = () => {
        if (closed || active !== state || ownerOf() !== owner || owner.isDestroyed() || owner.mainFrame !== frame || frame.detached || frame.url !== ownerUrl) throw new Error("Audio capture was canceled.");
      };
      const fail = (error: string, uploadId?: string) => {
        if (!closed && !owner.isDestroyed()) owner.send("couch:live-audio-error", { id: action.id, error, ...(uploadId ? { uploadId } : {}) });
        if (!uploadId) state.stop();
      };
      const wait = (request: number) => new Promise<AudioCaptureFormat | undefined>((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(request); reject(new Error("The audio capture did not respond.")); state.stop(); }, 5000);
        waiting.set(request, { resolve, reject, timer });
      });
      const onEvent = (event: IpcMainEvent, data: { id?: string; request?: number; ready?: boolean; error?: string; uploadId?: string; format?: AudioCaptureFormat }) => {
        if (closed || !helper || helper.isDestroyed() || event.sender !== helper.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== helperUrl || data?.id !== action.id) return;
        if (data.ready && !helperFrame) helperFrame = event.senderFrame;
        if (event.senderFrame !== helperFrame) return;
        const request = data.ready ? 0 : data.request;
        if (request !== undefined) {
          const pending = waiting.get(request);
          if (!pending) return;
          waiting.delete(request); clearTimeout(pending.timer);
          if (typeof data.error === "string") pending.reject(new Error(data.error)); else pending.resolve(data.format);
        } else if (typeof data.error === "string") fail(data.error, data.uploadId);
      };
      const ownerNavigation = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => { if (main) state.stop(); };
      const ownerGone = () => state.stop();
      const state: Active = {
        id: action.id,
        stop() {
          if (closed) return closing;
          closed = true;
          lifetime.abort();
          if (active === state) active = undefined;
          capture.clear();
          for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error("Audio capture was canceled.")); }
          waiting.clear();
          ipcMain.removeListener("couch:audio-capture-event", onEvent);
          owner.removeListener("did-start-navigation", ownerNavigation); owner.removeListener("destroyed", ownerGone); owner.removeListener("render-process-gone", ownerGone);
          if (helper && !helper.isDestroyed()) helper.destroy();
          closing = native?.stop() ?? Promise.resolve();
          retiring = closing;
          return closing;
        },
        async command(command) {
          ensure();
          if (native) { const result = await native.command(command); ensure(); return result; }
          if (command.op === "buffer") throw new Error("Only native inputs have a capture buffer.");
          if (!helper || helper.isDestroyed() || !helperFrame || helper.webContents.mainFrame !== helperFrame || helperFrame.detached || helperFrame.url !== helperUrl) throw new Error("The audio capture window changed.");
          const request = ++nextRequest, response = wait(request);
          helper.webContents.send("couch:audio-capture-command", { ...command, request });
          const result = await response; ensure(); return result;
        },
      };
      active = state;
      owner.on("did-start-navigation", ownerNavigation); owner.on("destroyed", ownerGone); owner.on("render-process-gone", ownerGone);
      ipcMain.on("couch:audio-capture-event", onEvent);
      try {
        if (action.deviceId.startsWith("native:")) {
          if (!nativeHelper) throw new Error("Native audio capture is not available in this app.");
          const inputs = await nativeAudioInputs(nativeHelper); ensure();
          const input = inputs.find(input => input.uid === action.deviceId.slice(7));
          if (!input) throw new Error("The selected native input is no longer available.");
          if (action.channelMap !== undefined && !isNativeChannelMap(action.channelMap, input.channels)) throw new Error("Choose an available channel or stereo pair for this native input.");
          state.nativeChannels = input.channels;
          await capture.prepare({ kind: "microphone" }); ensure();
          capture.consumeMicrophone();
          native = nativeAudioInput(nativeHelper, input, action.sampleRate ?? input.nominalRate, action.bufferFrames ?? 256, fail, lifetime.signal, action.sampleRate !== undefined, action.channelMap);
          const result = await native.prepare(); ensure();
          return result;
        }
        if (action.channelMap !== undefined) throw new Error("Choose a native input to select its channels.");
        helper = new BrowserWindow({ show: false, webPreferences: { session: owner.session, sandbox: true, contextIsolation: true, nodeIntegration: false,
          backgroundThrottling: false, preload: join(import.meta.dirname, "preload.cjs"), additionalArguments: [`--couch-audio-capture=${action.id}`] } });
        helper.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        helper.webContents.on("will-navigate", event => event.preventDefault());
        helper.webContents.on("did-start-navigation", (_event, _url, _inPlace, main) => { if (main && helperFrame) fail("The audio capture window navigated."); });
        helper.webContents.on("render-process-gone", () => fail("The audio capture process stopped."));
        helper.once("closed", () => { if (!closed) fail("The audio capture window closed."); });
        const ready = wait(0);
        await Promise.all([helper.loadURL(helperUrl), ready]); ensure();
        const pid = helper.webContents.getOSProcessId();
        if (!pid || pid === owner.getOSProcessId() || helper.isVisible() || helper.webContents.opener !== null) throw new Error("Couch could not isolate audio capture from its window.");
        await capture.prepare({ kind: "microphone" }); ensure();
        capture.delegateMicrophone(helper.webContents);
        const result = await state.command(action);
        await capture.prepare(null); ensure();
        return result;
      } catch (error) { await state.stop(); throw error; }
    },
  };
}
