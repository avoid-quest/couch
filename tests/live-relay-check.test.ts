import { expect, test } from "bun:test";
import { checkLiveRelay } from "../src/client/session/check-live-relay";

const relay = { urls: "turn:relay.example:3478", username: "fixture", credential: "private-fixture" };

test("relay check requires an allocated relay candidate, releases its peer, and never captures media", async () => {
  const original = globalThis.RTCPeerConnection;
  const peers: FakePeer[] = [];
  let candidateType = "relay";
  class FakePeer {
    onicecandidate: ((event: { candidate: { type: string } }) => void) | null = null;
    onicegatheringstatechange: (() => void) | null = null;
    iceGatheringState = "new";
    closed = false;
    constructor(readonly configuration: RTCConfiguration) { peers.push(this); }
    createDataChannel() {}
    async createOffer() { return { type: "offer" }; }
    async setLocalDescription() {
      this.onicecandidate?.({ candidate: { type: candidateType } });
      this.iceGatheringState = "complete";
      this.onicegatheringstatechange?.();
    }
    close() { this.closed = true; }
  }
  globalThis.RTCPeerConnection = FakePeer as unknown as typeof RTCPeerConnection;
  try {
    await checkLiveRelay(relay);
    expect(peers[0]!.configuration).toEqual({ iceServers: [relay] });
    expect(peers[0]!.closed).toBe(true);
    candidateType = "host";
    await expect(checkLiveRelay(relay)).rejects.toThrow("Couldn't reach the relay with these credentials.");
    expect(peers[1]!.closed).toBe(true);
    const canceled = new AbortController(); canceled.abort();
    await expect(checkLiveRelay(relay, canceled.signal)).rejects.toThrow("canceled");
    expect(peers[2]!.closed).toBe(true);
  } finally { globalThis.RTCPeerConnection = original; }
});
