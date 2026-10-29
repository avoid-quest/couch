import { beforeEach, expect, mock, test } from "bun:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveSharing } from "../src/client/session/live";
import type { Viewer } from "../src/client/sections/share/share";
import type { LiveAudioSettings } from "../src/shared/audio-settings";

// Product components with only their session, storage and request boundaries replaced.
let connected = true;
const run = mock(async (_action: unknown) => true);
const restart = mock(async (_frames: number) => {});
const preference = { save: mock((_value: string) => {}), error: undefined as string | undefined };
mock.module("../src/client/session/session-context", () => ({
  useSessionGate: () => ({ connected, run, credentials: { origin: "http://couch", token: "test" }, liveSharing: { setCaptureBuffer: restart }, setError() {} }),
  errorText: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
mock.module("../src/client/audio-settings", () => ({ useNativeInputBufferPreference: () => preference }));
const query = { data: { codec: "auto", minBufferMs: 200 } as LiveAudioSettings | undefined, error: null as Error | null, isFetching: false, refetch: mock(async () => {}) };
const save = { isPending: false, error: null as Error | null, variables: { minBufferMs: 350 } as Partial<LiveAudioSettings>, mutate: mock((_settings: Partial<LiveAudioSettings>, _options?: unknown) => {}) };
const realQuery = await import("@tanstack/react-query");
let mutationOptions: { mutationFn: (change: Partial<LiveAudioSettings>) => Promise<unknown> } | undefined, cached: LiveAudioSettings | undefined;
const sentBodies: unknown[] = [];
const realClient = await import("../src/client/api/client");
mock.module("../src/client/api/client", () => ({ ...realClient, apiSend: async (_credentials: unknown, _path: string, body: unknown) => { sentBodies.push(body); return body; } }));
mock.module("@tanstack/react-query", () => ({ ...realQuery, useQuery: () => query, useMutation: (options: typeof mutationOptions) => { mutationOptions = options; return save; }, useQueryClient: () => ({ setQueryData() {}, getQueryData: () => cached }) }));
const { LiveListeners, LiveSettings, LiveSettingsStatus, PlaybackBufferInput } = await import("../src/client/sections/share/LiveOperator");
const live = () => ({ settings: query.data, query, save, connected }) as unknown as Parameters<typeof PlaybackBufferInput>[0]["live"];
const sharing = { captureFormat: { sampleRate: 48000, channels: 2, native: { requestedFrames: 128, reportedFrames: 128 } } } as LiveSharing;

type Props = { children?: ReactNode; id?: string; disabled?: boolean; value?: unknown; onBlur?: (event: unknown) => void; onKeyDown?: (event: unknown) => void; onValueChange?: (value: string) => void; onSelect?: () => void; onCloseAutoFocus?: (event: unknown) => void; onClick?: () => void; [key: string]: unknown };
const elements = (node: ReactNode): { type: unknown; props: Props }[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
function read<T>(render: () => T): T {
  let result: T;
  renderToStaticMarkup(createElement(function Read() { result = render(); return null; }));
  return result!;
}

beforeEach(() => {
  connected = true; query.data = { codec: "auto", minBufferMs: 200 }; query.error = null; query.isFetching = false; save.isPending = false; save.error = null; preference.error = undefined;
  run.mockClear(); restart.mockClear(); preference.save.mockClear(); save.mutate.mockClear(); query.refetch.mockClear();
});

test("audio settings retain their labelled controls while loading and offer a fetch retry", () => {
  query.data = undefined;
  const html = renderToStaticMarkup(<LiveSettings sharing={sharing} />);
  expect(html).toContain('id="live-capture-buffer"');
  expect(html).toContain('id="live-codec"');
  expect(html).toContain('id="live-buffer"');
  expect(html).toContain("Loading audio settings…");
  query.error = new Error("Connection lost.");
  const failed = renderToStaticMarkup(<LiveSettings sharing={sharing} />);
  expect(failed).toContain("Couldn&#x27;t load audio settings. Connection lost.");
  expect(failed).toContain('role="alert"');
  const tree = LiveSettingsStatus({ live: live() });
  elements(tree).find(item => item.props.onClick)!.props.onClick!();
  expect(query.refetch).toHaveBeenCalledTimes(1);
});

test("settings saves and storage failures remain visible in the open share panel", () => {
  save.isPending = true;
  expect(renderToStaticMarkup(<LiveSettings sharing={sharing} />)).toContain("Saving audio settings…");
  save.isPending = false; save.error = new Error("Request timed out.");
  expect(renderToStaticMarkup(<LiveSettings sharing={sharing} />)).toContain("Couldn&#x27;t save audio settings. Request timed out.");
  elements(LiveSettingsStatus({ live: live() })).find(item => item.props.onClick)!.props.onClick!();
  expect(save.mutate).toHaveBeenCalledWith(save.variables);
  preference.error = "Allow local storage and try again.";
  expect(renderToStaticMarkup(<LiveSettings sharing={sharing} />)).toContain(preference.error);
});

test("a settings save sends only its change, merged into the settings current when it is sent", async () => {
  read(() => LiveSettings({ sharing }));
  cached = { codec: "pcm", minBufferMs: 200 }; // another admin chose PCM after this save failed
  sentBodies.length = 0;
  await mutationOptions!.mutationFn({ minBufferMs: 300 });
  expect(sentBodies).toEqual([{ settings: { codec: "pcm", minBufferMs: 300 } }]);
});

test("capture buffer changes refresh the parent so its delivered format and selection can update", async () => {
  const changed = mock(() => {});
  const tree = read(() => LiveSettings({ sharing, onCaptureChange: changed }));
  const select = elements(tree).find(item => item.props.value === "128")!;
  select.props.onValueChange!("512");
  expect(restart).toHaveBeenCalledWith(512);
  expect(preference.save).toHaveBeenCalledWith("512");
  await Promise.resolve(); await Promise.resolve();
  expect(changed).toHaveBeenCalledTimes(1);
});

test("playback buffer validates integers and commits the chosen value on blur or Enter", () => {
  const tree = read(() => PlaybackBufferInput({ id: "buffer", live: live() }));
  const input = elements(tree).find(item => item.props.id === "buffer")!;
  for (const value of [NaN, -1, 5001, 1.5]) input.props.onBlur!({ currentTarget: { valueAsNumber: value, validity: { valid: true } } });
  expect(save.mutate).not.toHaveBeenCalled();
  input.props.onBlur!({ currentTarget: { valueAsNumber: 350, validity: { valid: true } } });
  expect(save.mutate.mock.calls[0]![0]).toEqual({ minBufferMs: 350 });
  const preventDefault = mock(() => {});
  input.props.onKeyDown!({ key: "Enter", preventDefault, currentTarget: { valueAsNumber: 400, validity: { valid: true } } });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(save.mutate.mock.calls[1]![0]).toEqual({ minBufferMs: 400 });
});

test("saving keeps the active controls focusable while rejecting another edit", () => {
  save.isPending = true;
  const tree = read(() => PlaybackBufferInput({ id: "buffer", live: live() }));
  const input = elements(tree).find(item => item.props.id === "buffer")!;
  expect(input.props.disabled).toBeFalsy();
  expect(input.props.readOnly).toBe(true);
  input.props.onBlur!({ currentTarget: { valueAsNumber: 400, validity: { valid: true } } });
  const panel = read(() => LiveSettings({ sharing }));
  const codec = elements(panel).find(item => item.props.value === "auto")!;
  expect(codec.props.disabled).toBeFalsy();
  codec.props.onValueChange!("pcm");
  expect(save.mutate).not.toHaveBeenCalled();
});

test("disconnected share settings and listener actions stay disabled", () => {
  connected = false;
  const tree = read(() => LiveSettings({ sharing }));
  expect(elements(tree).filter(item => item.props.onValueChange).every(item => item.props.disabled)).toBe(true);
  expect(renderToStaticMarkup(<PlaybackBufferInput id="buffer" live={live()} />)).toContain("disabled");
  const listeners = renderToStaticMarkup(<LiveListeners viewers={[viewer()]} />);
  expect(listeners).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Options for Phone"/);
});

function viewer(): Viewer { return { device: { id: "phone", name: "Phone", online: true, volume: 50, muted: false }, playbackId: "live", picture: false, sound: true, playing: true, behind: false, delivery: "scheduled", delayActive: true }; }

test("listener failures are alerts and Remove addresses only the chosen listener", async () => {
  const failed = { ...viewer(), error: "The audio output is unavailable." };
  const html = renderToStaticMarkup(<LiveListeners viewers={[failed]} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("text-destructive");
  expect(html).toContain("The audio output is unavailable.");
  const tree = read(() => LiveListeners({ viewers: [failed] }));
  elements(tree).find(item => item.props.onSelect)!.props.onSelect!();
  expect(run).toHaveBeenCalledWith({ type: "removeLiveListener", playbackId: "live", deviceId: "phone" });
  const preventDefault = mock(() => {});
  elements(tree).find(item => item.props.onCloseAutoFocus)!.props.onCloseAutoFocus!({ preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(renderToStaticMarkup(<LiveListeners viewers={[]} />)).toContain('<span role="status">No listeners yet.</span>');
});
