import { useId, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, House, Info, Pause, Play, Square, Volume1, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Action, PlayerState } from "../../shared/protocol";

type RemoteKey = "up" | "down" | "left" | "right" | "select" | "back" | "home" | "info";

export function RemotePad({ connected, onNavigate, run, player }: {
  connected: boolean;
  onNavigate: (key: RemoteKey) => Promise<boolean>;
  run: (action: Action) => Promise<boolean>;
  player: PlayerState | null;
}) {
  const descriptionId = useId();
  const [failed, setFailed] = useState(false);
  const navigate = async (key: RemoteKey) => {
    if (!connected) return;
    try { setFailed(!await onNavigate(key)); }
    catch { setFailed(true); }
  };
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLElement
      && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const keys: Record<string, RemoteKey> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      Escape: "back", BrowserBack: "back", Home: "home", i: "info", I: "info",
    };
    // Buttons keep their native Enter/Space click. Only the pad itself maps them to OK.
    const key = event.target === event.currentTarget && ["Enter", " "].includes(event.key)
      ? "select" : keys[event.key];
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void navigate(key);
  };
  return <section className="remote-pad" aria-label="TV remote" aria-describedby={descriptionId}
    tabIndex={0} onKeyDown={keydown}>
    <div className="remote-pad-heading">
      <h2>TV remote</h2>
      <span className={`remote-pad-connection${connected ? " is-connected" : ""}`}>
        <i aria-hidden="true" />{connected ? "Ready" : "Offline"}
      </span>
    </div>
    <p id={descriptionId} className="remote-pad-description">Use the arrows to navigate the TV.</p>
    <div className="remote-pad-dial" role="group" aria-label="TV directions">
      <Button type="button" variant="outline" className="remote-pad-key remote-pad-up" aria-label="TV up"
        disabled={!connected} onClick={() => void navigate("up")}><ChevronUp /></Button>
      <Button type="button" variant="outline" className="remote-pad-key remote-pad-left" aria-label="TV left"
        disabled={!connected} onClick={() => void navigate("left")}><ChevronLeft /></Button>
      <Button type="button" className="remote-pad-key remote-pad-select" aria-label="TV select"
        disabled={!connected} onClick={() => void navigate("select")}>OK</Button>
      <Button type="button" variant="outline" className="remote-pad-key remote-pad-right" aria-label="TV right"
        disabled={!connected} onClick={() => void navigate("right")}><ChevronRight /></Button>
      <Button type="button" variant="outline" className="remote-pad-key remote-pad-down" aria-label="TV down"
        disabled={!connected} onClick={() => void navigate("down")}><ChevronDown /></Button>
    </div>
    <div className="remote-pad-tools">
      <Button type="button" variant="outline" className="remote-pad-tool" aria-label="TV back"
        disabled={!connected} onClick={() => void navigate("back")}><ArrowLeft /><span>Back</span></Button>
      <Button type="button" variant="outline" className="remote-pad-tool" aria-label="TV home"
        disabled={!connected} onClick={() => void navigate("home")}><House /><span>Home</span></Button>
      <Button type="button" variant="outline" className="remote-pad-tool" aria-label="TV info"
        disabled={!connected} onClick={() => void navigate("info")}><Info /><span>Info</span></Button>
    </div>
    <div className="remote-pad-tools" role="group" aria-label="Playback controls">
      <Button type="button" variant="outline" className="remote-pad-tool" aria-label={player?.status === "playing" ? "Pause" : "Play"} title={player?.status === "playing" ? "Pause" : "Play"}
        disabled={!connected || !player?.playbackId} onClick={() => void run({ type: "pause", playbackId: player!.playbackId!, paused: player!.status === "playing" })}>
        {player?.status === "playing" ? <><Pause /><span>Pause</span></> : <><Play /><span>Play</span></>}
      </Button>
      <Button type="button" variant="outline" className="remote-pad-tool" aria-label="Stop" title="Stop"
        disabled={!connected || !player?.playbackId} onClick={() => void run({ type: "stop" })}><Square /><span>Stop</span></Button>
      <Button type="button" variant="outline" className="remote-pad-tool" aria-label="Volume down" title="Volume down"
        disabled={!connected || !player?.playbackId} onClick={() => void run({ type: "volume", volume: Math.max(0, player!.volume - 10) })}><Volume1 /><span>Quieter</span></Button>
      <Button type="button" variant="outline" className="remote-pad-tool" aria-label="Volume up" title="Volume up"
        disabled={!connected || !player?.playbackId} onClick={() => void run({ type: "volume", volume: Math.min(100, player!.volume + 10) })}><Volume2 /><span>Louder</span></Button>
    </div>
    <p className={`remote-pad-hint${failed && connected ? " is-error" : ""}`} role="status">
      {!connected ? "Connect to your TV to use the remote." : failed
        ? "Could not send the command. Try again." : "Arrow keys work while this remote is focused."}
    </p>
  </section>;
}
