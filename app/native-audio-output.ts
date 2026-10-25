import { spawn } from "node:child_process";
import type { ClientOptions } from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import type { NativeOutputStart } from "../src/shared/native-output";
import { prepareNativePlayback } from "./native-playback";

/** One Live Sendspin session and its output; the renderer never forwards PCM. */
export function nativeAudioOutput(helper: string, origin: string, request: NativeOutputStart, tls: ClientOptions,
  failed: (error: string) => void, observed: (event: Record<string, unknown>) => void = () => {}) {
  const identity = Identity.fromPrivateB64u(request.privateKey);
  if (identity.peerId !== request.clientId) throw new Error("The native output must use this Device's identity.");
  const client = new SendspinClient(identity.peerId, request.name, [Roles.PLAYER], {
    encryption: { identity, suite: "25519_AESGCM_SHA256" },
    playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, channels: 2, sample_rate: 48000, bit_depth: 16 }],
      buffer_capacity: 128 * 1024, supported_commands: [PlayerCommand.VOLUME, PlayerCommand.MUTE, PlayerCommand.SET_STATIC_DELAY] },
  });
  let output: Awaited<ReturnType<typeof prepareNativePlayback>> | undefined;
  let stopped = false, admitted = false, epoch = 0, packets = 0, lastTimestamp: number | undefined, lastFrames = 0;
  let volume = 100, muted = false, timer: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  const lifetime = new AbortController();
  const report = (state: "preparing" | "ready" | "failed", error?: string) => client.sendPlayerState({
    required_lead_time_ms: state === "ready" ? Math.max(25, Math.ceil(output!.format.maxQueueUs / 1000) + 10) : 1000,
    min_buffer_ms: 25,
    couch_preparation: { receiverId: request.receiverId, epoch, ...(state === "failed" ? { state, error: error ?? "Native playback failed." } : { state }) },
  });
  const stop = (error?: string): Promise<void> => {
    if (closing) return closing;
    stopped = true; admitted = false; clearInterval(timer); lifetime.abort();
    closing = (async () => {
      if (client.isConnected) await report(error ? "failed" : "preparing", error).catch(() => {});
      await Promise.all([client.disconnect(), output?.stop()]);
    })();
    return closing;
  };
  const fail = (message: string) => {
    if (stopped) return;
    epoch++;
    void stop(message);
    failed(message);
  };
  client.addDisconnectListener(() => fail("The native audio connection closed. Leave and rejoin to reconnect."));
  client.addStreamClearListener(() => { if (packets) fail("Live audio restarted. Leave and rejoin to prepare the output again."); });
  client.addStreamEndListener(() => { if (packets) void stop(); });
  client.addServerCommandListener(command => {
    if (stopped || !command.player) return;
    try {
      const player = command.player;
      if (player.command === PlayerCommand.VOLUME) {
        if (!Number.isInteger(player.volume) || player.volume! < 0 || player.volume! > 100) throw new Error("Invalid stream volume.");
        volume = player.volume!; output?.setVolume(volume);
        void client.sendPlayerState({ volume }).catch(() => fail("The native audio connection closed."));
      } else if (player.command === PlayerCommand.MUTE) {
        if (typeof player.mute !== "boolean") throw new Error("Invalid stream mute.");
        muted = player.mute; output?.setMuted(muted);
        void client.sendPlayerState({ muted }).catch(() => fail("The native audio connection closed."));
      } else if (player.command === PlayerCommand.SET_STATIC_DELAY) {
        const delay = player.static_delay_ms;
        if (typeof delay !== "number" || !Number.isFinite(delay) || Math.abs(delay) > 5000) throw new Error("Invalid output delay.");
        // Moving deadlines during playback is not a clock drift correction.
        if (packets && delay !== client.staticDelayMs) { fail("Output delay changed. Leave and rejoin to apply it."); return; }
        client.setStaticDelayMs(delay);
        void client.sendPlayerState({ static_delay_ms: delay }).catch(() => fail("The native audio connection closed."));
      }
    } catch { fail("The native output received an invalid audio control."); }
  });
  const clockReady = () => client.isTimeSynchronized() && Number.isFinite(client.clockErrorUs) && client.clockErrorUs <= 10000;
  client.addAudioChunkListener((timestamp, pcm, format) => {
    if (stopped) return;
    try {
      if (!admitted || !output || !clockReady()) throw new Error("The native output lost clock readiness.");
      if (format.codec !== AudioCodec.PCM || format.pcm.sampleRate !== 48000 || format.pcm.channels !== 2 || format.pcm.bitDepth !== 16)
        throw new Error("The native output needs stereo PCM16 at 48 kHz.");
      if (lastTimestamp !== undefined && Math.abs(timestamp - lastTimestamp - lastFrames * 1e6 / 48000) > 2)
        throw new Error("The native audio stream has a missing or repeated block.");
      output.write(pcm, client.computePlayTime(timestamp));
      packets++; lastTimestamp = timestamp; lastFrames = pcm.length / 4;
    } catch (error) { fail(error instanceof Error ? error.message : "Native audio playback failed."); }
  });
  const ready = (async () => {
    try {
      output = await prepareNativePlayback(spawn(helper, ["", String(request.bufferMs), "0"], { stdio: ["pipe", "pipe", "pipe"] }),
        error => fail(error.message), observed, lifetime.signal);
      if (stopped) { await output.stop(); return; }
      output.setVolume(volume); output.setMuted(muted);
      await client.connect(origin.replace(/^http/, "ws") + "/sendspin", { timeoutMs: 5000,
        webSocketOptions: { ...tls, origin, handshakeTimeout: 5000, followRedirects: false } });
      if (stopped) { await client.disconnect(); return; }
      await report("preparing");
      const started = performance.now();
      let reporting = false;
      timer = setInterval(() => {
        if (stopped || reporting) return;
        if (!clockReady()) {
          if (admitted || performance.now() - started > 15000) fail("The native output could not maintain a synchronized clock.");
          return;
        }
        if (!admitted) {
          reporting = true;
          // Set before sending: the server can deliver PCM as soon as this report arrives.
          admitted = true;
          void report("ready").then(() => observed({ event: "prepared", clockErrorUs: client.clockErrorUs }),
            () => fail("The native output could not report readiness.")).finally(() => { reporting = false; });
        }
      }, 100);
    } catch {
      fail("The native output could not start. Check the output device and reconnect.");
      await stop();
    }
  })();
  return { ready, stop: async () => { await stop(); await ready; await output?.stop(); } };
}
