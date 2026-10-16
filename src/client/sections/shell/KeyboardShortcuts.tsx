import { useCouchHotkeys } from "@/useCouchHotkeys";
import { useSessionGate } from "@/session/session-context";
import { usePlaybackClock } from "@/session/playback-clock";
import { muted, playbackCapabilities } from "@/components/PlaybackTransport";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useShell } from "./shell-context";

const help = [
  ["K / Space", "Play or pause"], ["J / L", "Back / forward 10 seconds"],
  ["← / →", "Back / forward 5 seconds in the player"], ["↑ / ↓", "Raise / lower volume in the player"],
  ["0–9", "Jump to 0–90%"], ["M", "Mute or unmute"], ["C", "Toggle subtitles"],
  ["F", "Toggle fullscreen in the player"], ["Shift + N", "Play next"],
  ["H / S", "Home / Library"], ["/", "Search"], [",", "Settings"],
  ["P / Q", "Player / Up next"], ["Esc", "Close panel or go back"], ["?", "Keyboard shortcuts"],
];

export function KeyboardShortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const shell = useShell();
  const { state, connected, run, seekBy } = useSessionGate();
  const clock = usePlaybackClock();
  const player = state?.player;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  const { available, transportReady, seekable, pausable, audioReady, nextReady, hasNext } = playbackCapabilities(state, connected);
  const canPause = !!current && (player?.status === "ended" ? available : transportReady && pausable);
  const pause = () => {
    if (player?.status === "ended" && current) void run({ type: "play", entryId: current.id, fromStart: true });
    else if (player?.playbackId) void run({ type: "pause", playbackId: player.playbackId, paused: player.status === "playing" });
  };
  const canSeek = transportReady && seekable;
  const subtitles = player?.tracks?.filter(track => track.kind === "subtitle") ?? [];
  const canVolume = available && audioReady;
  const volume = (delta: number) => void run({ type: "volume", volume: Math.max(0, Math.min(100, (player?.volume ?? 0) + delta)) });
  useCouchHotkeys([
    { hotkey: "K", action: pause, enabled: canPause },
    { hotkey: "Space", action: pause, enabled: canPause, backgroundOnly: true },
    { hotkey: "J", action: () => seekBy(-10), enabled: canSeek },
    { hotkey: "L", action: () => seekBy(10), enabled: canSeek },
    { hotkey: "ArrowLeft", action: () => seekBy(-5), enabled: canSeek && shell.section === "Now", backgroundOnly: true },
    { hotkey: "ArrowRight", action: () => seekBy(5), enabled: canSeek && shell.section === "Now", backgroundOnly: true },
    { hotkey: "ArrowUp", action: () => volume(5), enabled: canVolume && shell.section === "Now", backgroundOnly: true },
    { hotkey: "ArrowDown", action: () => volume(-5), enabled: canVolume && shell.section === "Now", backgroundOnly: true },
    ...(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((hotkey, digit) => ({ hotkey, enabled: canSeek && clock.playbackId === player?.playbackId && !!clock.duration, action: () => { if (player?.playbackId && clock.duration) void run({ type: "seek", playbackId: player.playbackId, position: clock.duration * digit / 10 }); } })),
    { hotkey: "M", enabled: canVolume, action: () => void run({ type: "mute", muted: !muted(state) }) },
    { hotkey: "C", enabled: transportReady && subtitles.length > 0, action: () => { if (player?.playbackId) void run({ type: "track", playbackId: player.playbackId, kind: "subtitle", index: subtitles.some(track => track.selected) ? -1 : subtitles[0]!.index }); } },
    { hotkey: "Shift+N", enabled: nextReady && hasNext, action: () => { if (player?.playbackId) void run({ type: "next", playbackId: player.playbackId }); } },
    { hotkey: "H", action: () => shell.changeSection("Home") },
    { hotkey: "S", action: () => shell.changeSection("Library") },
    { hotkey: "/", action: shell.focusSearch },
    { hotkey: ",", action: () => shell.changeSection("Settings") },
    { hotkey: "P", enabled: !!current, action: () => shell.openPlayer() },
    { hotkey: "Q", action: () => shell.openPlayer("queue") },
    { hotkey: "Shift+?", action: () => onOpenChange(true) },
  ]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Shortcuts work in the player, and while browsing. Typing and open panels keep their own keys, and Space and the arrows leave a focused control alone.</DialogDescription></DialogHeader>
    <dl className="divide-y text-sm">{help.map(([keys, label]) => <div key={keys} className="flex items-center justify-between gap-6 py-2"><dt>{label}</dt><dd className="shrink-0"><kbd className="font-sans text-muted-foreground">{keys}</kbd></dd></div>)}</dl>
  </DialogContent></Dialog>;
}
