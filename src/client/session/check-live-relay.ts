import type { LiveRelay } from "../../shared/live-relay";

// A relay candidate proves an authenticated allocation from this browser, not
// receiver reachability or end-to-end playback. No capture or media is needed.
export async function checkLiveRelay(relay: LiveRelay, signal?: AbortSignal): Promise<void> {
  const connection = new RTCPeerConnection({ iceServers: [relay] });
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        connection.onicecandidate = connection.onicegatheringstatechange = null;
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new Error("Relay check canceled."));
      const unavailable = () => finish(new Error("Couldn't reach the relay with these credentials. Check its address, username, password and network access."));
      const timeout = setTimeout(unavailable, 10_000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      connection.onicecandidate = event => { if (event.candidate?.type === "relay") finish(); };
      connection.onicegatheringstatechange = () => { if (connection.iceGatheringState === "complete") unavailable(); };
      connection.createDataChannel("relay-check");
      void connection.createOffer().then(offer => connection.setLocalDescription(offer)).catch(unavailable);
    });
  } finally { connection.close(); }
}
