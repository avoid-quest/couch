import { livePlayback } from "@/session/playback-controls";
import { deviceId } from "@/session/device-id";
import { Hotkey, useHotkey, type HotkeyProps } from "@videojs/react";
import { useCouchHotkeys, useShortcutFocus } from "@/useCouchHotkeys";
import type { RefObject } from "react";
import { useSessionGate } from "@/session/session-context";
import { muted, playbackCapabilities } from "@/components/PlaybackTransport";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hasUpNext } from "@/sections/now/QueuePanel";
import { useShell } from "./shell-context";

const help = [
  ["K / Space", "Play or pause"],
  ["Hold Space", "Play at 2× while held in the player"],
  ["< / >", "Slower / faster in the player"],
  ["J / L", "Back / forward 10 seconds"],
  ["← / →", "Back / forward 5 seconds in the player"],
  ["↑ / ↓", "Raise / lower volume in the player"],
  ["0–9", "Jump to 0–90%"],
  ["M", "Mute or unmute"],
  ["C", "Toggle subtitles"],
  ["F", "Toggle fullscreen in the player"],
  ["I", "Show or hide info in the player"],
  ["Shift + N", "Play next"],
  ["H / S", "Home / Saved"],
  ["/", "Search"],
  [",", "Settings"],
  ["P / Q", "Player / Up next"],
  ["Esc", "Close panel or go back"],
  ["?", "Keyboard shortcuts"],
];

/** Shared by the picture and the now-playing bar. Video.js resolves each action against their CouchMedia. */
export function PlaybackHotkeys({
  speed = false,
  holdSpace,
}: { speed?: boolean; holdSpace?: () => void } = {}) {
  const { state, connected, tvPresentation } = useSessionGate();
  const { section, current } = useShell();
  const focus = useShortcutFocus();
  useHotkey({
    keys: "Space",
    target: "document",
    repeatable: false,
    disabled: !holdSpace || focus !== "background",
    onActivate: () => holdSpace?.(),
  });
  if (tvPresentation || section === "Remote" || livePlayback(state) || focus === "blocked")
    return null;
  const caps = playbackCapabilities(state, connected);
  const player = state?.player;
  const letters = section !== "Search" || focus === "control";
  const inPlayer = section === "Now" && focus === "background";
  const pause =
    !!current &&
    (player?.status === "ended"
      ? caps.available && caps.programme
      : caps.transportReady && caps.pausable);
  const seek = caps.transportReady && caps.seekable;
  const sound = caps.available && caps.audioReady;
  const captions =
    caps.programme &&
    caps.transportReady &&
    !!player?.tracks?.some((track) => track.kind === "subtitle");
  const bindings: [string, HotkeyProps["action"], boolean, number?][] = [
    ["k", "togglePaused", letters && pause],
    ["Space", "togglePaused", focus === "background" && pause && !holdSpace],
    ["j", "seekStep", letters && seek],
    ["l", "seekStep", letters && seek],
    ["0-9", "seekToPercent", letters && seek],
    ["m", "toggleMuted", letters && sound],
    ["c", "toggleSubtitles", letters && captions],
    ["ArrowLeft", "seekStep", inPlayer && seek, -5],
    ["ArrowRight", "seekStep", inPlayer && seek, 5],
    ["ArrowUp", "volumeStep", inPlayer && sound],
    ["ArrowDown", "volumeStep", inPlayer && sound],
    ["<", "speedDown", inPlayer && speed],
    [">", "speedUp", inPlayer && speed],
  ];
  return bindings.map(
    ([keys, action, enabled, value]) =>
      enabled && <Hotkey key={keys} target="document" keys={keys} action={action} value={value} />,
  );
}

export function KeyboardShortcuts({
  open,
  onOpenChange,
  openerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openerRef: RefObject<HTMLElement | null>;
}) {
  const shell = useShell();
  const { state, connected, run } = useSessionGate();
  const player = state?.player;
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const { available, audioReady, nextReady, hasNext } = playbackCapabilities(state, connected);
  // Live has device-local sound and no Video.js transport. Idle devices also keep their mute key.
  const deviceSound = livePlayback(state) || !current;
  const own = livePlayback(state)
    ? state?.devices?.find((device) => device.id === deviceId())
    : undefined;
  const volumeTarget = livePlayback(state) ? { deviceId: deviceId() } : {};
  const canVolume = livePlayback(state) ? connected && !!own?.online : available && audioReady;
  const volume = (delta: number) =>
    void run({
      type: "volume",
      ...volumeTarget,
      volume: Math.max(0, Math.min(100, (own?.volume ?? player?.volume ?? 0) + delta)),
    });
  useCouchHotkeys([
    {
      hotkey: "M",
      enabled: deviceSound && canVolume,
      action: () => void run({ type: "mute", ...volumeTarget, muted: !muted(state) }),
    },
    {
      hotkey: "ArrowUp",
      enabled: deviceSound && canVolume && shell.section === "Now",
      backgroundOnly: true,
      action: () => volume(5),
    },
    {
      hotkey: "ArrowDown",
      enabled: deviceSound && canVolume && shell.section === "Now",
      backgroundOnly: true,
      action: () => volume(-5),
    },
    {
      hotkey: "Shift+N",
      enabled: nextReady && hasNext,
      action: () => {
        if (player?.playbackId) void run({ type: "next", playbackId: player.playbackId });
      },
    },
    { hotkey: "H", action: () => shell.changeSection("Home") },
    { hotkey: "S", action: () => shell.changeSection("Saved") },
    { hotkey: "/", action: shell.focusSearch },
    { hotkey: ",", action: () => shell.changeSection("Settings") },
    { hotkey: "P", enabled: !!current, action: () => shell.openPlayer() },
    { hotkey: "Q", enabled: hasUpNext(state), action: () => shell.openPlayer("queue") },
    {
      hotkey: "Shift+?",
      action: () => {
        openerRef.current = document.activeElement as HTMLElement;
        onOpenChange(true);
      },
    },
  ]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="[--dialog-max-height:85dvh]"
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) {
            event.preventDefault();
            openerRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work in the player, and while browsing. Typing and open panels keep their own
            keys, and Space and the arrows leave a focused control alone.
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y text-sm">
          {help.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-6 py-2">
              <dt>{label}</dt>
              <dd className="shrink-0">
                <kbd className="font-sans text-muted-foreground">{keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
