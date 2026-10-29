import { beforeEach, expect, mock, test } from "bun:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveSharing } from "../src/client/session/live";
import type { Viewer } from "../src/client/sections/share/share";
import type { LiveAudioSettings } from "../src/shared/audio-settings";
import { spawnSync } from "node:child_process";
import type { SessionState } from "../src/shared/protocol";

// Product components with only their session, storage and request boundaries replaced.
let connected = true;
let state: Pick<SessionState, "playbacks" | "devices"> | undefined;
const run = mock(async (_action: unknown) => true);
const restart = mock(async (_action: unknown) => {});
const setError = mock((_error: string) => {});
const preference = { save: mock((_value: string) => {}), error: undefined as string | undefined };
const channelPreference = { save: mock((_value: string) => {}), error: undefined as string | undefined };
mock.module("../src/client/session/session-context", () => ({
  useSessionGate: () => ({ connected, state, run, credentials: { origin: "http://couch", token: "test" }, liveSharing: { setCaptureInput: restart }, setError }),
  errorText: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
mock.module("../src/client/audio-settings", () => ({ useNativeInputBufferPreference: () => preference, useNativeInputChannelPreference: () => channelPreference }));
const query = { data: { codec: "auto", minBufferMs: 200 } as LiveAudioSettings | undefined, error: null as Error | null, isFetching: false, refetch: mock(async () => {}) };
const save = { isPending: false, error: null as Error | null, variables: { minBufferMs: 350 } as Partial<LiveAudioSettings>, mutate: mock((_settings: Partial<LiveAudioSettings>, _options?: unknown) => {}) };
const realQuery = await import("@tanstack/react-query");
let mutationOptions: { mutationFn: (change: Partial<LiveAudioSettings>) => Promise<unknown> } | undefined, cached: LiveAudioSettings | undefined;
const sentBodies: unknown[] = [];
const realClient = await import("../src/client/api/client");
mock.module("../src/client/api/client", () => ({ ...realClient, apiSend: async (_credentials: unknown, _path: string, body: unknown) => { sentBodies.push(body); return body; } }));
mock.module("@tanstack/react-query", () => ({ ...realQuery, useQuery: () => query, useMutation: (options: typeof mutationOptions) => { mutationOptions = options; return save; }, useQueryClient: () => ({ setQueryData() {}, getQueryData: () => cached }) }));
const { CaptureBufferSelect, CaptureChannelsSelect, LiveListeners, LiveSettings, LiveSettingsStatus, PlaybackBufferInput } = await import("../src/client/sections/share/LiveOperator");
const { LiveMetadataFields } = await import("../src/client/sections/share/LiveMetadata");
const live = () => ({ settings: query.data, query, save, connected }) as unknown as Parameters<typeof PlaybackBufferInput>[0]["live"];
const sharing = { source: { id: "concert" }, captureFormat: { sampleRate: 48000, channels: 2, native: { requestedFrames: 128, reportedFrames: 128, inputChannels: 4, channelMap: [0, 1] } } } as LiveSharing;

type Props = { children?: ReactNode; id?: string; disabled?: boolean; value?: unknown; onBlur?: (event: unknown) => void; onKeyDown?: (event: unknown) => void; onValueChange?: (value: string) => void; onSelect?: () => void; onCloseAutoFocus?: (event: unknown) => void; onClick?: () => void; [key: string]: unknown };
const elements = (node: ReactNode): { type: unknown; props: Props }[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
function read<T>(render: () => T): T {
  let result: T;
  renderToStaticMarkup(createElement(function Read() { result = render(); return null; }));
  return result!;
}

beforeEach(() => {
  state = undefined;
  connected = true; query.data = { codec: "auto", minBufferMs: 200 }; query.error = null; query.isFetching = false; save.isPending = false; save.error = null; preference.error = undefined; channelPreference.error = undefined;
  run.mockClear(); restart.mockReset(); restart.mockImplementation(async () => {}); setError.mockClear(); preference.save.mockClear(); channelPreference.save.mockClear(); save.mutate.mockClear(); query.refetch.mockClear();
});

test("the host sees Core's retained shared lead and its Receiver even after that Receiver leaves, whichever playback carries it", () => {
  state = {
    playbacks: [{ id: "live", title: "Concert", status: "playing", outputs: [], liveSourceId: "concert", liveLead: { ms: 240, deviceId: "phone" } }],
    devices: [{ id: "phone", name: "Phone", online: false, volume: 100, muted: false }],
  };
  expect(renderToStaticMarkup(<LiveSettings sharing={sharing} />)).toContain("Shared lead: 240 ms · set by Phone");
  state.devices = [];
  expect(renderToStaticMarkup(<LiveSettings sharing={sharing} />)).toContain("Shared lead: 240 ms · set by a previous listener");
  state.playbacks!.unshift({ id: "other", title: "Concert", status: "playing", outputs: [], liveSourceId: "concert" });
  expect(renderToStaticMarkup(<LiveSettings sharing={sharing} />)).toContain("Shared lead: 240 ms");
  state.playbacks!.shift();
  state.playbacks![0]!.liveSourceId = "another-share";
  expect(renderToStaticMarkup(<LiveSettings sharing={sharing} />)).not.toContain("Shared lead:");
});

test("audio settings retain their labelled controls while loading and offer a fetch retry", () => {
  query.data = undefined;
  const html = renderToStaticMarkup(<LiveSettings sharing={sharing} />);
  expect(html).toContain('id="live-capture-buffer"');
  expect(html).toContain('id="live-capture-channels"');
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
  preference.error = undefined; channelPreference.error = "Couldn’t save input channels.";
  const channelError = renderToStaticMarkup(<LiveSettings sharing={sharing} />);
  expect(channelError).toContain('role="alert"');
  expect(channelError).toContain(channelPreference.error);
});

test("a settings save sends only its change, merged into the settings current when it is sent", async () => {
  read(() => LiveSettings({ sharing }));
  cached = { codec: "pcm", minBufferMs: 200 }; // another admin chose PCM after this save failed
  sentBodies.length = 0;
  await mutationOptions!.mutationFn({ minBufferMs: 300 });
  expect(sentBodies).toEqual([{ settings: { codec: "pcm", minBufferMs: 300 } }]);
});

test.each([
  { id: "live-capture-buffer", value: "512", action: { op: "buffer", bufferFrames: 512 }, stored: preference },
  { id: "live-capture-channels", value: "3/4", action: { op: "channels", channelMap: [2, 3] }, stored: channelPreference },
  { id: "live-capture-channels", value: "3", action: { op: "channels", channelMap: [2] }, stored: channelPreference },
])("capture changes refresh the delivered format and selection: $id $value", async ({ id, value, action, stored }) => {
  const changed = mock(() => {});
  const tree = read(() => LiveSettings({ sharing, onCaptureChange: changed }));
  const select = elements(tree).find(item => item.props.id === id)!;
  select.props.onValueChange!(value);
  expect(restart).toHaveBeenCalledWith(action);
  expect(stored.save).toHaveBeenCalledWith(value);
  await Promise.resolve(); await Promise.resolve();
  expect(changed).toHaveBeenCalledTimes(1);
});

test("native channel choices only appear for inputs with more than two channels", () => {
  const stereo = { ...sharing, captureFormat: { ...sharing.captureFormat!, native: { ...sharing.captureFormat!.native!, inputChannels: 2 } } };
  expect(renderToStaticMarkup(<LiveSettings sharing={stereo} />)).not.toContain('id="live-capture-channels"');
});

test("both capture controls keep their trigger focusable during a restart", () => {
  for (const control of [
    <CaptureBufferSelect id="capture" value="128" open={false} restarting />,
    <CaptureChannelsSelect id="capture" channels={4} value="1/2" open={false} restarting />,
  ]) {
    const html = renderToStaticMarkup(control);
    expect(html).toMatch(/<button[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
    expect(html).toContain('aria-expanded="false"');
  }
});

test.each(["live-capture-buffer", "live-capture-channels"])("capture failures report the reason without refreshing the format: %s", async id => {
  restart.mockRejectedValueOnce(new Error("The input is unavailable."));
  const changed = mock(() => {});
  const tree = read(() => LiveSettings({ sharing, onCaptureChange: changed }));
  elements(tree).find(item => item.props.id === id)!.props.onValueChange!(id === "live-capture-buffer" ? "512" : "3/4");
  await Promise.resolve(); await Promise.resolve();
  expect(setError).toHaveBeenCalledWith("The input is unavailable.");
  expect(changed).not.toHaveBeenCalled();
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

test("Live details are optional labelled inputs that retain drafts and respect connection state", () => {
  const changed = mock((_value: unknown) => {});
  const value = { title: "Evening concert", description: "Piano · first set" };
  const tree = read(() => LiveMetadataFields({ value, onChange: changed }));
  const fields = elements(tree).filter(item => item.props.maxLength === 200);
  expect(fields).toHaveLength(2);
  const html = renderToStaticMarkup(tree);
  expect(html).toContain(">Title</label>"); expect(html).toContain(">Now playing</label>");
  expect(html).toContain('value="Evening concert"'); expect(html).toContain('placeholder="Optional"');
  expect(html).not.toContain("required");
  (fields[1]!.props.onChange as (event: unknown) => void)({ target: { value: "Second set" } });
  expect(changed).toHaveBeenCalledWith({ ...value, description: "Second set" });
  expect(renderToStaticMarkup(<LiveMetadataFields value={value} onChange={changed} disabled />)).toMatch(/<input[^>]*disabled=""/);
  expect(renderToStaticMarkup(<LiveMetadataFields value={value} onChange={changed} readOnly />)).toMatch(/<input[^>]*readOnly=""/);
});

test("the host saves details once, retains failed drafts for retry and clears fields explicitly", () => {
  // An isolated hook boundary lets the actual form handle edits and async results across renders.
  const result = spawnSync(process.execPath, ["-e", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    const react = await import("react");
    let slots = [], cursor = 0, connected = true, settle, reject;
    const sent = [];
    mock.module("react", () => ({ ...react, useId: () => "details", useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = value; }];
    }, useRef: initial => { const index = cursor++; return slots[index] ??= { current: initial }; } }));
    mock.module("./src/client/session/session-context.tsx", () => ({ errorText: reason => reason.message,
      useSessionGate: () => ({ connected, command: action => { sent.push(action); return new Promise((resolve, fail) => { settle = resolve; reject = fail; }); } }) }));
    const { LiveMetadataEditor, LiveMetadataFields } = await import("./src/client/sections/share/LiveMetadata.tsx");
    const source = { id: "concert", metadata: { title: "Concert", description: "First set" } };
    const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : react.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
    const render = () => { cursor = 0; return LiveMetadataEditor({ source }); };
    const fields = tree => nodes(tree).find(node => node.type === LiveMetadataFields).props;
    const submit = tree => tree.props.onSubmit({ preventDefault() {} });
    let tree = render();
    assert.equal(nodes(tree).find(node => node.props.type === "submit").props.disabled, true);
    fields(tree).onChange({ title: "Evening concert", description: "Second set" });
    tree = render();
    const saving = submit(tree);
    await submit(tree);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { type: "updateLiveMetadata", sourceId: "concert", metadata: { title: "Evening concert", description: "Second set" } });
    assert.equal(fields(render()).readOnly, true);
    reject(new Error("Connection lost.")); await saving;
    tree = render();
    assert.equal(nodes(tree).find(node => node.props.role === "alert").props.children, "Connection lost.");
    assert.equal(fields(tree).value.description, "Second set");
    const retry = submit(tree); settle(); await retry;
    assert.equal(sent.length, 2);
    connected = false;
    tree = render(); assert.equal(fields(tree).disabled, true); await submit(tree); assert.equal(sent.length, 2);
    connected = true;
    fields(render()).onChange({ title: "", description: "" });
    const clearing = submit(render()); settle(); await clearing;
    assert.deepEqual(sent.at(-1).metadata, { title: "", description: "" });
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
