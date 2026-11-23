import { livePlayback } from "@/session/playback-controls";
import { deviceId } from "@/session/device-id";
import { useCouchPlayer } from "@/components/CouchPlayer";
import { useCouchHotkeys } from "@/useCouchHotkeys";
import type { RefObject } from "react";
import { useSessionGate } from "@/session/session-context";
import { playbackCapabilities } from "@/components/PlaybackTransport";
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
  const store = useCouchPlayer();
  const player = state?.player;
  const { current, section } = shell;
  const {
    available,
    audioReady,
    nextReady,
    hasNext,
    transportReady,
    seekable,
    canTogglePaused,
    programme,
  } = playbackCapabilities(state, connected);
  const live = livePlayback(state);
  const seek = transportReady && seekable && !live;
  const seekBy = (seconds: number) => store.state.seek(store.state.currentTime + seconds);
  const toggle = () => (store.state.paused ? store.state.play() : store.state.pause());
  // A Live listener controls its own sound, even while controlling a TV.
  const own = live ? state?.devices?.find((device) => device.id === deviceId()) : undefined;
  const canVolume = live ? connected && !!own?.online : available && audioReady;
  const liveArrows = section === "Now" && live && canVolume;
  const liveVolume = (delta: number) =>
    void run({
      type: "volume",
      deviceId: deviceId(),
      volume: Math.max(0, Math.min(100, (own?.volume ?? 0) + delta)),
    });
  useCouchHotkeys([
    { hotkey: "K", enabled: canTogglePaused && !live, action: toggle },
    {
      hotkey: "Space",
      enabled: canTogglePaused && !live && section !== "Now",
      backgroundOnly: true,
      action: toggle,
    },
    { hotkey: "J", enabled: seek, action: () => seekBy(-10) },
    { hotkey: "L", enabled: seek, action: () => seekBy(10) },
    {
      hotkey: "ArrowUp",
      enabled: liveArrows,
      backgroundOnly: true,
      action: () => liveVolume(5),
    },
    {
      hotkey: "ArrowDown",
      enabled: liveArrows,
      backgroundOnly: true,
      action: () => liveVolume(-5),
    },
    {
      hotkey: "M",
      enabled: canVolume,
      action: () =>
        live
          ? void run({ type: "mute", deviceId: deviceId(), muted: !own?.muted })
          : store.state.setMuted(!(store.state.muted || store.state.volume === 0)),
    },
    {
      hotkey: "C",
      enabled:
        programme &&
        transportReady &&
        !live &&
        !!player?.tracks?.some((track) => track.kind === "subtitle"),
      action: () => store.state.toggleSubtitles(),
    },
    ...(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((hotkey, digit) => ({
      hotkey,
      enabled: seek,
      action: () => {
        if (store.state.duration > 0) store.state.seek((store.state.duration * digit) / 10);
      },
    })),
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
