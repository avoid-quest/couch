import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveSharing } from "../src/client/session/live";
import type { LiveAudioSettings } from "../src/shared/audio-settings";

// The real share panel with only its session, storage and request boundaries replaced.
mock.module("../src/client/session/session-context", () => ({
  useSessionGate: () => ({ connected: true, state: undefined, run: async () => true, credentials: { origin: "http://couch", token: "test" }, liveSharing: { setCaptureInput: async () => {} }, setError() {} }),
  errorText: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
const preference = { save() {}, error: undefined };
mock.module("../src/client/audio-settings", () => ({ useNativeInputBufferPreference: () => preference, useNativeInputChannelPreference: () => preference }));
const query = { data: { codec: "auto", minBufferMs: 200 } as LiveAudioSettings, error: null, isFetching: false, refetch: async () => {} };
const save = { isPending: false, error: null, variables: undefined, mutate() {} };
const realQuery = await import("@tanstack/react-query");
let mutationOptions: { mutationFn: (change: Partial<LiveAudioSettings>) => Promise<unknown> } | undefined, cached: LiveAudioSettings | undefined;
const sentBodies: unknown[] = [];
const realClient = await import("../src/client/api/client");
mock.module("../src/client/api/client", () => ({ ...realClient, apiSend: async (_credentials: unknown, _path: string, body: unknown) => { sentBodies.push(body); return body; } }));
mock.module("@tanstack/react-query", () => ({ ...realQuery, useQuery: () => query, useMutation: (options: typeof mutationOptions) => { mutationOptions = options; return save; }, useQueryClient: () => ({ setQueryData() {}, getQueryData: () => cached }) }));
const { LiveSettings } = await import("../src/client/sections/share/LiveOperator");
const sharing = { source: { id: "concert" }, captureFormat: { sampleRate: 48000, channels: 2, native: { requestedFrames: 128, reportedFrames: 128, inputChannels: 4, channelMap: [0, 1] } } } as LiveSharing;

test("a settings save sends only its change, merged into the settings current when it is sent", async () => {
  renderToStaticMarkup(createElement(function Read() { LiveSettings({ sharing }); return null; }));
  cached = { codec: "pcm", minBufferMs: 200 }; // another admin chose PCM after this save failed
  await mutationOptions!.mutationFn({ minBufferMs: 300 });
  expect(sentBodies).toEqual([{ settings: { codec: "pcm", minBufferMs: 300 } }]);
});
