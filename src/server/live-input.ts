import { timingSafeEqual } from "node:crypto";
import type { LiveMetadata, LivePeer, LiveSignalMessage, LiveSource } from "../shared/live-input";
import type { Action, PlaybackCommand, ServerMessage } from "../shared/protocol";

type Load = Extract<PlaybackCommand, { type: "load" }>;
// relay: Core's buffered link for a receiver that couldn't connect directly, instead of a peer.
type Receiver<Socket> = { socket: Socket; deviceId: string; picture: boolean; sound: boolean; volume: number; relay?: string };
// Receivers that couldn't connect directly play this source through Core's stream instead.
// uploadId: Core asks for encoded capture only while something plays it buffered. Each request has its own identity.
// A hosted publication (AirPlay) has no capturing window: Core feeds its stream, and every receiver plays that.
type Publication<Socket> = { source: LiveSource; startedAt: number; owner?: Socket; uploadToken?: string; relayed: Set<string>; uploadId?: string };
type Peer<Socket> = LivePeer & { publisher?: Socket; receiver: Socket; sourceId: string; playbackId: string; loadId: string; volume: number; relay?: string };
const metadata = (value: LiveMetadata) => ({ title: value.title?.trim() || undefined, description: value.description?.trim() || undefined });

// Core grants each peer to two exact admitted connections. Signaling has no arbitrary target.
export function createLiveInputs<Socket>(options: {
  deviceOf: (socket: Socket) => string;
  nameOf: (id: string) => string;
  send: (socket: Socket, message: ServerMessage) => void;
  ended: (source: LiveSource, publisherName?: string) => void;
  changed: () => void;
}) {
  const sources = new Map<string, Publication<Socket>>();
  const peers = new Map<string, Peer<Socket>>();
  const announcements = new Set<string>();
  let announcing: ReturnType<typeof setImmediate> | undefined;
  const announce = (sourceId: string) => {
    announcements.add(sourceId);
    // A burst of socket closes or joins needs one current list, not every intermediate routing.
    announcing ??= setImmediate(() => {
      announcing = undefined;
      const changed = [...announcements]; announcements.clear();
      for (const sourceId of changed) {
        const publication = sources.get(sourceId);
        if (publication?.owner) options.send(publication.owner, { type: "livePeers", sourceId, upload: !!publication.uploadId, uploadId: publication.uploadId, peers: [...peers.values()].filter(peer => peer.sourceId === sourceId && !peer.relay).map(({ peerId, deviceId, picture, sound }) => ({ peerId, deviceId, picture, sound })) });
      }
    });
  };
  const removePeer = (peer: Peer<Socket>) => {
    peers.delete(peer.peerId);
    options.send(peer.receiver, { type: "player", command: { type: "stop" } });
  };
  const end = (sourceId: string, publisherName?: string) => {
    const publication = sources.get(sourceId);
    if (!publication) return;
    sources.delete(sourceId);
    announcements.delete(sourceId);
    // Publish the ending notice before any peer's Stop can close its player.
    options.ended(publication.source, publisherName);
    for (const peer of [...peers.values()]) if (peer.sourceId === sourceId) removePeer(peer);
    if (publication.owner) options.send(publication.owner, { type: "livePeers", sourceId, upload: false, peers: [] });
    options.changed();
  };
  return {
    sources: () => [...sources.values()].map(publication => publication.source),
    source: (sourceId: string) => sources.get(sourceId)?.source,
    position: (sourceId: string) => { const publication = sources.get(sourceId); return publication ? (performance.now() - publication.startedAt) / 1000 : 0; },
    publish(socket: Socket, action: Extract<Action, { type: "publishLive" }>): LiveSource {
      if (sources.has(action.sourceId)) throw new Error("That live source already exists.");
      for (const [sourceId, publication] of sources) if (publication.owner === socket) end(sourceId);
      const deviceId = options.deviceOf(socket);
      const label = action.kind === "microphone" ? "Audio input" : action.kind === "system-audio" ? "System audio" : "Screen";
      const source: LiveSource = { id: action.sourceId, deviceId, name: action.name?.trim() || `${options.nameOf(deviceId)} · ${label}`, kind: action.kind, audio: action.audio, video: action.video, ...(action.intent ? { intent: action.intent } : {}), ...(action.audioDelivery ? { audioDelivery: action.audioDelivery } : {}) };
      source.startedAt = Date.now();
      if (action.intent === "live") source.metadata = metadata(action.metadata ?? {});
      sources.set(source.id, { source, startedAt: performance.now(), owner: socket, uploadToken: action.uploadToken, relayed: new Set() });
      options.changed();
      return source;
    },
    updateMetadata(socket: Socket, sourceId: string, patch: LiveMetadata) {
      const publication = sources.get(sourceId);
      if (!publication) throw new Error("That live source has ended.");
      if (publication.owner !== socket) throw new Error("Only the capturing window can edit this source.");
      if (publication.source.intent !== "live") throw new Error("Only Live audio has shared details.");
      publication.source.metadata = metadata({ ...publication.source.metadata, ...patch });
      options.changed();
      return publication.source;
    },
    // Core's own publication, ended only by Core.
    host(source: LiveSource) {
      if (sources.has(source.id)) throw new Error("That live source already exists.");
      sources.set(source.id, { source, startedAt: performance.now(), relayed: new Set() });
      options.changed();
    },
    unhost(sourceId: string) { if (sources.has(sourceId) && !sources.get(sourceId)!.owner) end(sourceId); },
    hosted: (sourceId: string) => sources.has(sourceId) && !sources.get(sourceId)!.owner,
    acceptsUpload(sourceId: string, deviceId: string, key: string, uploadId?: string) {
      const publication = sources.get(sourceId);
      if (!publication?.uploadToken || publication.source.deviceId !== deviceId) return false;
      if (publication.source.audioDelivery === "pcm" && (!uploadId || publication.uploadId !== uploadId)) return false;
      const expected = Buffer.from(publication.uploadToken), supplied = Buffer.from(key);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    },
    acceptsUploadFailure(socket: Socket, sourceId: string, uploadId: string) {
      const publication = sources.get(sourceId);
      if (!publication) return false; // Already ended or replaced.
      if (publication.owner !== socket) throw new Error("Only the capturing window can fail this upload.");
      // The media socket can close and another receiver retry before an old control message arrives.
      return publication.uploadId === uploadId;
    },
    upload(sourceId: string, upload: boolean) {
      const publication = sources.get(sourceId);
      if (!publication || !!publication.uploadId === upload) return;
      publication.uploadId = upload ? crypto.randomUUID() : undefined;
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
        if (existing) {
          // Routing another output must not make this renderer echo its unchanged level.
          if (existing.volume !== receiver.volume) {
            existing.volume = receiver.volume;
            options.send(receiver.socket, { type: "player", command: { type: "volume", volume: receiver.volume } });
          }
          continue;
        }
        const peer: Peer<Socket> = { peerId: crypto.randomUUID(), deviceId: receiver.deviceId, picture: receiver.picture, sound: receiver.sound, publisher: publication.owner, receiver: receiver.socket, sourceId, playbackId, loadId: load.playbackId, volume: receiver.volume, relay: receiver.relay };
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
      const other = peer.publisher === socket ? peer.receiver : peer.publisher;
      if (other) options.send(other, message);
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
    relayed: (sourceId: string, deviceId: string) => { const publication = sources.get(sourceId); return !!publication && (!publication.owner || publication.relayed.has(deviceId)); },
    // The tabs a Direct playback's controls reach: each receiver, peer or relay.
    receivers: (playbackId: string) => [...peers.values()].filter(peer => peer.playbackId === playbackId).map(peer => peer.receiver),
    // A Device that leaves a playback takes only its own peers along.
    closePlayback(playbackId: string, deviceId?: string) {
      const changed = new Set<string>();
      for (const peer of [...peers.values()]) if (peer.playbackId === playbackId && (!deviceId || peer.deviceId === deviceId)) { removePeer(peer); changed.add(peer.sourceId); }
      for (const sourceId of changed) announce(sourceId);
    },
    disconnect(socket: Socket, publisherName?: string) {
      for (const [sourceId, publication] of [...sources]) if (publication.owner === socket) end(sourceId, publisherName);
      const changed = new Set<string>();
      for (const peer of [...peers.values()]) if (peer.receiver === socket) { peers.delete(peer.peerId); changed.add(peer.sourceId); }
      for (const sourceId of changed) announce(sourceId);
    },
    close() { clearImmediate(announcing); announcing = undefined; announcements.clear(); for (const sourceId of [...sources.keys()]) end(sourceId); },
  };
}
