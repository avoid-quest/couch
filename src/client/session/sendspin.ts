import { readLiveOutputBackend, readNativeOutputBuffer, readOutputBufferPreference } from "../audio-settings";
import { outputLatencyHint } from "../../shared/audio-settings";
import type { SendspinPlayer } from "@sendspin/sendspin-js";
import { createReceiverAdmission } from "./receiver-admission";
import { waitForTap } from "./renderer";
import { storage } from "./device-id";
import { couchApp } from "./native-context";
import { failed } from "../toasts";

// Synced sound (#644 ticket 10): while Core asks, this tab plays its Device's sound with the
// official Sendspin player. The SDK's stored key is the Device's ID, so Core knows the speaker.
// A tab that shows a synced picture connects too, only for the clock it follows (ticket 11).
let player: Promise<SendspinPlayer> | null = null;
let connected: SendspinPlayer | null = null;
let group: string | undefined;
let hearing = false;
let intent: "relaxed" | "live" = "relaxed";
let admission: ReturnType<typeof setInterval> | undefined;
let readiness: ReturnType<typeof createReceiverAdmission> | undefined;
let removeOutputListener: (() => void) | undefined;
let receiverId: string | undefined;
type NativeSession = { id: string; removeError?: () => void };
let native: NativeSession | undefined;
let retiringNative = Promise.resolve(), outputGeneration = 0;

const stopReadiness = () => {
  clearInterval(admission); admission = undefined; readiness?.close(); readiness = undefined; removeOutputListener?.(); removeOutputListener = undefined;
};
function prepare(created: SendspinPlayer) {
  if (intent !== "live" || !hearing || readiness) return;
  const id = receiverId;
  const guard = readiness = createReceiverAdmission(created, () => connected === created && hearing && receiverId === id, (report, timing) => {
    if (id) created.setOutputPreparation({ ...report, receiverId: id }, timing);
    else { // A legacy Core cannot negotiate the extension; retain its numeric path.
      if (timing) created.setMinBufferMs(timing.minBufferMs);
      created.setRequiredLeadTimeMs(timing?.requiredLeadTimeMs ?? 1000);
    }
  });
  const outputChanged = () => guard.outputChanged();
  navigator.mediaDevices?.addEventListener("devicechange", outputChanged);
  removeOutputListener = () => navigator.mediaDevices?.removeEventListener("devicechange", outputChanged);
  admission = setInterval(() => void guard.tick(), 250);
}

export function listen(on: boolean, watch: boolean, name: string, nextIntent: "relaxed" | "live" = "relaxed", nextReceiverId?: string) {
  // Native audio currently handles audio-only Live sessions. Pictures retain the browser's sound clock.
  const useNative = on && !watch && nextIntent === "live" && nextReceiverId && couchApp?.liveOutput && readLiveOutputBackend() === "native";
  if (useNative && native?.id === nextReceiverId) return;
  const generation = ++outputGeneration;
  if (native) {
    const previous = native; native = undefined; previous.removeError?.();
    retiringNative = retiringNative.then(() => couchApp!.liveOutput!({ op: "stop", receiverId: previous.id })).catch(() => {});
  }
  if (!useNative) {
    void retiringNative.then(() => { if (generation === outputGeneration) browserListen(on, watch, name, nextIntent, nextReceiverId); });
    return;
  }
  const browser = player;
  browserListen(false, false, name);
  const current: NativeSession = native = { id: nextReceiverId };
  current.removeError = couchApp!.onLiveOutputError?.(event => { if (native === current && event.receiverId === current.id) failed(event.error); });
  void (async () => {
    await retiringNative;
    await browser?.then(stopped => stopped.disconnect("user_request"));
    if (native !== current || generation !== outputGeneration) return;
    const { exportSendspinClientIdentity } = await import("@sendspin/sendspin-js");
    if (native !== current || generation !== outputGeneration) return;
    if (!await couchApp!.nativeAudioOutputAvailable?.()) throw new Error("Native audio output is unavailable. Choose Browser in advanced audio settings.");
    if (native !== current || generation !== outputGeneration) return;
    await couchApp!.liveOutput!({ op: "start", receiverId: current.id, ...exportSendspinClientIdentity(storage), name,
      bufferMs: Number(readNativeOutputBuffer()) });
  })().catch(error => { if (native === current) failed(error instanceof Error ? error.message : "Native audio could not start."); });
}

function browserListen(on: boolean, watch: boolean, name: string, nextIntent: "relaxed" | "live" = "relaxed", nextReceiverId?: string) {
  if ((on || watch) && (intent !== nextIntent || on && nextIntent === "live" && receiverId !== nextReceiverId)) { browserListen(false, false, name); intent = nextIntent; }
  if (!on) { stopReadiness(); receiverId = undefined; }
  if (!on && !watch) {
    const current = player;
    player = connected = null;
    group = undefined;
    hearing = false;
    waitForTap(null);
    void current?.then(stopped => stopped.disconnect("user_request"));
    return;
  }
  const hear = on && !hearing;
  hearing = on;
  if (on) receiverId = nextReceiverId;
  if (!on) waitForTap(null);
  const current: Promise<SendspinPlayer> = player ??= import("@sendspin/sendspin-js").then(({ SendspinPlayer }) => {
    // AES-GCM: Core runs on Electron's Node, whose BoringSSL has no ChaCha20-Poly1305.
    const created = new SendspinPlayer({ baseUrl: location.origin, clientName: name, productName: "Couch", ...(intent === "live" ? { outputMode: "direct" as const, outputLatencyHint: outputLatencyHint(readOutputBufferPreference()), sampleCorrectionMode: "rate" as const, requiredLeadTimeMs: 1000 } : {}), suite: "aesgcm", storage,
      onConnectionChange: () => { if (connected === created && hearing && intent === "live") readiness?.outputChanged(); },
      onStateChange: state => { if (player === current) group = state.groupState.group_id; } });
    if (player !== current) return created;
    connected = created;
    // Only fixed-deadline live audio withdraws admission and discards old output.
    // Relaxed playback retains the SDK's queued send-ahead samples across routes.
    prepare(created);
    void created.connect().catch(() => {});
    return created;
  });
  if (!hear) return;
  void current.then(created => {
    if (player !== current || !hearing) return;
    prepare(created);
    // A browser that wants a gesture before it plays sound asks for a tap on its own screen (#644).
    let unlocked = false;
    void created.unlock().then(() => { if (player !== current || !hearing) return; void readiness?.tick(); unlocked = true; waitForTap(null); }, () => {});
    setTimeout(() => { if (!unlocked && player === current && hearing) waitForTap(() => void created.unlock().then(() => { if (player === current && hearing) { void readiness?.tick(); waitForTap(null); } }, () => {})); }, 500);
  });
}

// Where the sound of Playback `id` is now, on this Device's synced clock: what a picture follows.
export function soundClock(id: string) {
  const progress = connected?.isConnected && connected.timeSyncInfo.synced && group === id ? connected.trackProgress : null;
  return progress ? { position: progress.positionMs / 1000, speed: progress.playbackSpeed } : null;
}
