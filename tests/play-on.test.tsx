import { expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { deviceId } from "../src/client/session/device-id";

const here = deviceId();
const devices = [{ id: here, name: "Phone", online: true, volume: 50, muted: false }, { id: "mac", name: "Mac", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } }];
// Bun shares module mocks between test files, so this one provides both session hooks.
const gate = () => ({ state: { devices, controlling: here } });
mock.module("../src/client/session/session-context", () => ({ useOptionalSessionGate: gate, useSessionGate: gate }));
const { PlayOnGroup } = await import("../src/client/components/PlayOn");

type Item = { disabled?: boolean; onSelect?: () => void; children?: ReactNode };
// Device rows, read from the element tree without a DOM; the Play on rows' own component renders as a function.
function rows(node: ReactNode): ReactElement<Item>[] {
  if (Array.isArray(node)) return node.flatMap(rows);
  if (!isValidElement<Item & { onPlay?: unknown }>(node)) return [];
  if (typeof node.type === "function" && "onPlay" in node.props && node.type.name === "Devices") return rows((node.type as (props: unknown) => ReactNode)(node.props));
  if (node.props.onSelect) return [node];
  return rows(node.props.children);
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join(" ") : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === "string" ? node : "";

test("Play on keeps a shared source's publisher selectable, so choosing it opens Where it plays", () => {
  const played: string[] = [];
  const items = rows(PlayOnGroup({ onPlay: id => played.push(id), sharingDeviceId: "mac" }));
  const mac = items.find(item => text(item.props.children).includes("Mac"))!;
  expect(text(mac.props.children)).toContain("Sharing this source");
  expect(mac.props.disabled).toBeFalsy();
  mac.props.onSelect!();
  expect(played).toEqual(["mac"]);
  expect(items.find(item => text(item.props.children).includes("Phone"))?.props.disabled).toBeFalsy();
});

test("Live Play on offers only listening devices, excluding its publisher and picture-only outputs", () => {
  const screen = { id: "screen", name: "Picture only", online: true, volume: 50, muted: false, sharing: { video: true, audio: false } };
  devices.push(screen);
  try {
    const played: string[] = [];
    const items = rows(PlayOnGroup({ onPlay: id => played.push(id), sharingDeviceId: "mac", liveAudio: true }));
    expect(items.map(item => text(item.props.children))).toEqual(["Phone This device"]);
    items[0]!.props.onSelect!();
    expect(played).toEqual([here]);
  } finally { devices.pop(); }
});
