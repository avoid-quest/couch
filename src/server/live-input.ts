import { timingSafeEqual } from "node:crypto";
import type { LivePeer, LiveSignalMessage, LiveSource } from "../shared/live-input";
import type { Action, PlaybackCommand, ServerMessage } from "../shared/protocol";

type Load = Extract<PlaybackCommand, { type: "load" }>;
// relay: Core's buffered link for a receiver that couldn't connect directly, instead of a peer.
type Receiver<Socket> = { socket: Socket; deviceId: string; picture: boolean; sound: boolean; volume: number; relay?: string };
// Receivers that couldn't connect directly play this source through Core's stream instead.
// upload: Core asks the publisher for its encoded capture only while something plays it buffered.
type Publication<Socket> = { source: LiveSource; owner: Socket; uploadToken: string; relayed: Set<string>; upload: boolean };
type Peer<Socket> = LivePeer & { publisher: Socket; receiver: Socket; sourceId: string; playbackId: string; loadId: string; relay?: string };

// Core grants each peer to two exact admitted connections. Signaling has no arbitrary target.
export function createLiveInputs<Socket>(options: {
  deviceOf: (socket: Socket) => string;
  nameOf: (id: string) => string;
  send: (socket: Socket, message: ServerMessage) => void;
  ended: (sourceId: string) => void;
  changed: () => void;
}) {
  const sources = new Map<string, Publication<Socket>>();
  const peers = new Map<string, Peer<Socket>>();
  const announce = (sourceId: string) => {
    const publication = sources.get(sourceId);
    if (publication) options.send(publication.owner, { type: "livePeers", sourceId, upload: publication.upload, peers: [...peers.values()].filter(peer => peer.sourceId === sourceId && !peer.relay).map(({ peerId, deviceId, picture, sound }) => ({ peerId, deviceId, picture, sound })) });
  };
  const removePeer = (peer: Peer<Socket>) => {
    peers.delete(peer.peerId);
    options.send(peer.receiver, { type: "player", command: { type: "stop" } });
  };
  const end = (sourceId: string) => {
    const publication = sources.get(sourceId);
    if (!publication) return;
    for (const peer of [...peers.values()]) if (peer.sourceId === sourceId) removePeer(peer);
    options.send(publication.owner, { type: "livePeers", sourceId, upload: false, peers: [] });
    sources.delete(sourceId);
    options.ended(sourceId);
    options.changed();
  };
  return {
    sources: () => [...sources.values()].map(publication => publication.source),
    source: (sourceId: string) => sources.get(sourceId)?.source,
    publish(socket: Socket, action: Extract<Action, { type: "publishLive" }>): LiveSource {
      if (sources.has(action.sourceId)) throw new Error("That live source already exists.");
      for (const [sourceId, publication] of sources) if (publication.owner === socket) end(sourceId);
      const deviceId = options.deviceOf(socket);
      const label = action.kind === "microphone" ? "Microphone" : action.kind === "system-audio" ? "System audio" : "Screen";
      const source: LiveSource = { id: action.sourceId, deviceId, name: action.name?.trim() || `${options.nameOf(deviceId)} · ${label}`, kind: action.kind, audio: action.audio, video: action.video };
      sources.set(source.id, { source, owner: socket, uploadToken: action.uploadToken, relayed: new Set(), upload: false });
      options.changed();
      return source;
    },
    acceptsUpload(sourceId: string, deviceId: string, key: string) {
      const publication = sources.get(sourceId);
      if (!publication || publication.source.deviceId !== deviceId) return false;
      const expected = Buffer.from(publication.uploadToken), supplied = Buffer.from(key);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    },
    upload(sourceId: string, upload: boolean) {
      const publication = sources.get(sourceId);
      if (!publication || publication.upload === upload) return;
      publication.upload = upload;
      announce(sourceId);
    },
    end(socket: Socket, sourceId: string) {
      const source = sources.get(sourceId);
      if (!source) return;
      if (source.owner !== socket) throw new Error("Only the capturing window can end this source.");
      end(sourceId);
    },
    route(playbackId: string, sourceId: string, load: Load | undefined, receivers: Receiver<Socket>[]) {
      const publication = sources.get(sourceId);
      const wanted = publication && load ? receivers : [];
      const changed = new Set<string>();
      for (const peer of [...peers.values()]) if (peer.playbackId === playbackId && (!wanted.some(receiver => receiver.socket === peer.receiver && receiver.picture === peer.picture && receiver.sound === peer.sound && receiver.relay === peer.relay) || peer.loadId !== load?.playbackId || peer.sourceId !== sourceId)) {
        removePeer(peer);
        changed.add(peer.sourceId);
      }
      if (publication && load) for (const receiver of wanted) {
        const existing = [...peers.values()].find(peer => peer.playbackId === playbackId && peer.receiver === receiver.socket);
        if (existing) { options.send(receiver.socket, { type: "player", command: { type: "volume", volume: receiver.volume } }); continue; }
        const peer: Peer<Socket> = { peerId: crypto.randomUUID(), deviceId: receiver.deviceId, picture: receiver.picture, sound: receiver.sound, publisher: publication.owner, receiver: receiver.socket, sourceId, playbackId, loadId: load.playbackId, relay: receiver.relay };
        peers.set(peer.peerId, peer);
        if (peer.relay) {
          // Core's channel-filtered stream in the ordinary player: the publisher sends it nothing.
          options.send(receiver.socket, { type: "player", command: { ...load, source: peer.relay, hls: true, paused: load.paused ?? false } });
          options.send(receiver.socket, { type: "player", command: { type: "volume", volume: receiver.volume } });
          continue;
        }
        // The peer carries the media: no HLS link reaches a Direct receiver.
        options.send(receiver.socket, { type: "player", command: { ...load, source: "", hls: undefined, liveSourceId: sourceId, livePeerId: peer.peerId, liveOutput: { picture: peer.picture, sound: peer.sound, volume: receiver.volume }, paused: load.paused ?? false } });
        changed.add(sourceId);
      }
      for (const id of changed) announce(id);
    },
    receive(socket: Socket, message: LiveSignalMessage) {
      const peer = peers.get(message.peerId);
      if (!peer) return; // ICE may arrive after an output was stopped or replaced.
      if (peer.publisher !== socket && peer.receiver !== socket) throw new Error("This connection has no live peer permission.");
      options.send(peer.publisher === socket ? peer.receiver : peer.publisher, message);
    },
    // Either end reports a peer that can't connect; its receiver is relayed from now on.
    unreachable(socket: Socket, peerId: string) {
      const peer = peers.get(peerId);
      if (!peer) return; // Already stopped or replaced.
      if (peer.publisher !== socket && peer.receiver !== socket) throw new Error("This connection has no live peer permission.");
      sources.get(peer.sourceId)?.relayed.add(peer.deviceId);
      peers.delete(peerId);
      announce(peer.sourceId);
      return peer;
    },
    relayed: (sourceId: string, deviceId: string) => !!sources.get(sourceId)?.relayed.has(deviceId),
    // The tabs a Direct playback's controls reach: each receiver, peer or relay.
    receivers: (playbackId: string) => [...peers.values()].filter(peer => peer.playbackId === playbackId).map(peer => peer.receiver),
    // A Device that leaves a playback takes only its own peers along.
    closePlayback(playbackId: string, deviceId?: string) {
      const changed = new Set<string>();
      for (const peer of [...peers.values()]) if (peer.playbackId === playbackId && (!deviceId || peer.deviceId === deviceId)) { removePeer(peer); changed.add(peer.sourceId); }
      for (const sourceId of changed) announce(sourceId);
    },
    disconnect(socket: Socket) {
      for (const [sourceId, publication] of [...sources]) if (publication.owner === socket) end(sourceId);
      const changed = new Set<string>();
      for (const peer of [...peers.values()]) if (peer.receiver === socket) { peers.delete(peer.peerId); changed.add(peer.sourceId); }
      for (const sourceId of changed) announce(sourceId);
    },
    close() { for (const sourceId of [...sources.keys()]) end(sourceId); },
  };
}
