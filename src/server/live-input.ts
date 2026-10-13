import { timingSafeEqual } from "node:crypto";
import type { LiveSource } from "../shared/live-input";
import type { Action } from "../shared/protocol";

type Publication<Socket> = { source: LiveSource; owner: Socket; uploadToken: string };

// Capture ownership ends with its exact publishing connection. Playback is ordinary media.
export function createLiveInputs<Socket>(options: {
  deviceOf: (socket: Socket) => string;
  nameOf: (id: string) => string;
  ended: (sourceId: string) => void;
  changed: () => void;
}) {
  const sources = new Map<string, Publication<Socket>>();
  const end = (sourceId: string) => {
    if (!sources.delete(sourceId)) return;
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
      sources.set(source.id, { source, owner: socket, uploadToken: action.uploadToken });
      options.changed();
      return source;
    },
    acceptsUpload(sourceId: string, deviceId: string, key: string) {
      const publication = sources.get(sourceId);
      if (!publication || publication.source.deviceId !== deviceId) return false;
      const expected = Buffer.from(publication.uploadToken), supplied = Buffer.from(key);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    },
    end(socket: Socket, sourceId: string) {
      const source = sources.get(sourceId);
      if (!source) return;
      if (source.owner !== socket) throw new Error("Only the capturing window can end this source.");
      end(sourceId);
    },
    failed: end,
    disconnect(socket: Socket) { for (const [sourceId, publication] of sources) if (publication.owner === socket) end(sourceId); },
    close() { for (const sourceId of sources.keys()) end(sourceId); },
  };
}
