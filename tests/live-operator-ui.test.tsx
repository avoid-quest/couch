import { expect, mock, test } from "bun:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Action, LiveAudioSettings, LiveListenerStatus } from "../src/shared/protocol";
import type { ClientSessionState } from "../src/client/session/session";
import type { LiveSharing } from "../src/client/session/live";
import type { LiveListeners as Polled } from "../src/client/api/settings";

// The host's Live audio rows and settings, from session state and Core's polled measurements. Only browser, hook and
// query boundaries are replaced.
const react = await import("react");
mock.module("react", () => ({ ...react, useEffect: () => {} }));
const sent: Action[] = [], saved: Partial<LiveAudioSettings>[] = [];
let state: ClientSessionState, polled: Polled | undefined, settings: LiveAudioSettings;
const run = async (action: Action) => { sent.push(action); return true; };
mock.module("../src/client/session/session-context", () => ({
  useSessionGate: () => ({ state, run, credentials: { origin: "http://couch", token: "host" }, setError() {}, liveSharing: { setCaptureBuffer: async () => {} } }),
  errorText: (reason: unknown) => String(reason),
}));
const query = await import("@tanstack/react-query");
mock.module("@tanstack/react-query", () => ({
  ...query, queryOptions: (options: unknown) => options, useQueryClient: () => ({ setQueryData() {} }),
  useQuery: (options: { queryKey: string[] }) => ({ data: options.queryKey[0] === "live" ? polled : settings }),
  useMutation: () => ({ isPending: false, mutate: (patch: Partial<LiveAudioSettings>) => saved.push(patch) }),
}));
const { LiveListeners, LiveSettings } = await import("../src/client/sections/share/LiveOperator");
const { viewersOf } = await import("../src/client/sections/share/share");
const { defaultLiveAudioSettings } = await import("../src/shared/audio-settings");

const sharing = { source: { id: "source", name: "Studio Mac · Audio input", kind: "microphone", intent: "live", audio: true, video: false, deviceId: "host" },
  captureFormat: { sampleRate: 48000, channels: 2, native: { requestedFrames: 128, reportedFrames: 128, inputLatencyMs: 7 } } } as unknown as LiveSharing;
const listener = (status: Partial<LiveListenerStatus>): LiveListenerStatus => ({ codec: "pcm", status: "ok", latencyMs: 31, marginMs: 4, gaps: 0, concealments: 0, behindMs: 0, ...status });
function fixture(listeners: Record<string, LiveListenerStatus | undefined>, leadMs = 40): ClientSessionState {
  const outputs = Object.entries(listeners).map(([deviceId, liveListener]) => ({ deviceId, picture: false, sound: true, ...liveListener ? { liveListener } : {} }));
  return { devices: Object.keys(listeners).map(id => ({ id, name: id, online: true, volume: 80, muted: false })),
    playbacks: [{ id: "playback", title: "Studio Mac · Audio input", status: "playing", liveSourceId: "source", intent: "live", outputs, liveLeadMs: leadMs }],
    liveSources: [{ id: "source", name: "Studio Mac · Audio input", deviceId: "host", kind: "microphone", audio: true, video: false, intent: "live" }] } as unknown as ClientSessionState;
}
const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>).replaceAll("&gt;", ">");
type Props = { children?: ReactNode; onSelect?: () => unknown; [key: string]: unknown };
const elements = (node: ReactNode): { props: Props }[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
// A component's own element tree, from inside a render so its hooks run.
function read(render: () => ReactNode) {
  let result: ReactNode;
  renderToStaticMarkup(createElement(function Read() { result = render(); return null; }));
  return result;
}

test("rows render from state, then from Core's polled measurements, with the shared lead and full loop", () => {
  settings = defaultLiveAudioSettings; polled = undefined;
  state = fixture({});
  let markup = html(<LiveListeners sharing={sharing} viewers={viewersOf(state, "source")} />);
  expect(markup).toContain("Lead 40 ms · Full loop ≈ 47 ms");
  expect(markup).toContain("Not playing anywhere yet.");
  state = fixture({ Kitchen: listener({ status: "warming", latencyMs: null, marginMs: null }), Desk: undefined });
  markup = html(<LiveListeners sharing={sharing} viewers={viewersOf(state, "source")} />);
  expect(markup).toContain("2 listening · Lead 40 ms");
  expect(markup).toContain("Preparing audio…");
  expect(markup).toContain("Connecting…");
  // The poll wins over state, which carries a listener only as of its last change of standing.
  state = fixture({ Kitchen: listener({}), Desk: listener({}), Pixel: listener({}) }, 100);
  polled = { leadMs: 100, listeners: [
    { deviceId: "Kitchen", ...listener({ status: "limiting", latencyMs: 97 }) },
    { deviceId: "Desk", ...listener({ codec: "opus", gaps: 1 }) },
    { deviceId: "Pixel", ...listener({ status: "behind", latencyMs: 140, marginMs: -20, gaps: 3, concealments: 2, behindMs: 19.2 }) },
  ] };
  markup = html(<LiveListeners sharing={sharing} viewers={viewersOf(state, "source")} />);
  expect(markup).toContain("3 listening · Lead 100 ms, at its maximum · Full loop ≈ 107 ms");
  expect(markup).toContain("Sets the lead · PCM · latency 97 ms · margin 4 ms · 0 gaps");
  expect(markup).toContain("Opus · latency 31 ms · margin 4 ms · 1 gap");
  expect(markup).toContain("Behind by 20 ms · PCM · latency 140 ms · margin -20 ms · 3 gaps · 2 concealed");
});

test("Remove sends the host's drop for that listener's playback", async () => {
  settings = defaultLiveAudioSettings; polled = undefined; sent.length = 0;
  state = fixture({ Kitchen: listener({}), Pixel: listener({}) });
  const tree = read(() => LiveListeners({ sharing, viewers: viewersOf(state, "source") }));
  const removes = elements(tree).filter(element => element.props.children === "Remove");
  expect(removes).toHaveLength(2);
  await removes[1]!.props.onSelect!();
  expect(sent).toEqual([{ type: "removeLiveListener", playbackId: "playback", deviceId: "Pixel" }]);
});

test("Automatic shows its bounds and Raise for the slowest; Fixed hides them; Opus shows its bitrate", () => {
  polled = { leadMs: 63, listeners: [] }; saved.length = 0;
  settings = defaultLiveAudioSettings;
  let markup = html(<LiveSettings sharing={sharing} />);
  for (const label of ["Capture buffer", "Codec", "Lead", "Maximum", "Minimum", "Raise for the slowest", "Listener buffer"]) expect(markup).toContain(`>${label}<`);
  expect(markup).not.toContain(">Bitrate<");
  expect(markup).not.toContain("Fixed at");
  // Fixed starts where the lead is now.
  const lead = elements(read(() => LiveSettings({ sharing }))).find(element => element.props.value === "automatic" && typeof element.props.onValueChange === "function")!;
  (lead.props.onValueChange as (value: string) => void)("fixed");
  expect(saved).toEqual([{ lead: "fixed", leadMs: 63 }]);
  settings = { ...defaultLiveAudioSettings, lead: "fixed", leadMs: 63, codec: "opus", opusBitrate: 128000 };
  markup = html(<LiveSettings sharing={sharing} />);
  expect(markup).toContain("Fixed at");
  expect(markup).toContain("63 ms");
  expect(markup).not.toContain("Maximum");
  expect(markup).not.toContain("Minimum");
  expect(markup).not.toContain("Raise for the slowest");
  expect(markup).toContain(">Bitrate<");
  expect(elements(read(() => LiveSettings({ sharing }))).some(element => element.props.value === "128000")).toBe(true);
  // A browser input has no capture buffer to choose.
  markup = html(<LiveSettings sharing={{ ...sharing, captureFormat: { sampleRate: 48000, channels: 2 } }} />);
  expect(markup).not.toContain("Capture buffer");
});
