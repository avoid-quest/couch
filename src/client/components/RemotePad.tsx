import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, House, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Action, SessionState } from "../../shared/protocol";
import type { Credentials } from "../session/session";
import { PlaybackTransport, PlaybackVolume } from "./PlaybackTransport";
import { deviceName, offline } from "@/copy";
import { cn } from "@/lib/utils";

type RemoteKey = "up" | "down" | "left" | "right" | "select" | "back" | "home" | "info";

export function RemotePad({ connected, onNavigate, run, state, credentials }: {
  connected: boolean;
  onNavigate: (key: RemoteKey) => Promise<boolean>;
  run: (action: Action) => Promise<boolean>;
  state: SessionState | null;
  credentials: Credentials;
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
  const name = deviceName(state?.installationName);
  const key = (direction: RemoteKey, label: string, icon: ReactNode, className: string) => <Button type="button" variant={direction === "select" ? "default" : "outline"} size="icon" className={cn("size-12 touch:size-12", className)} aria-label={label}
    disabled={!connected} onClick={() => void navigate(direction)}>{icon}</Button>;
  const tool = (direction: RemoteKey, label: string, icon: ReactNode) => <Button type="button" variant="outline" aria-label={`TV ${label.toLowerCase()}`}
    disabled={!connected} onClick={() => void navigate(direction)}>{icon}{label}</Button>;
  return <section data-remote-pad className="grid min-w-0 gap-4 outline-none" aria-label="TV remote" aria-describedby={descriptionId} tabIndex={0} onKeyDown={keydown}>
    <div className="mx-auto grid grid-cols-3 gap-1" role="group" aria-label="TV directions">
      {key("up", "TV up", <ChevronUp />, "col-start-2")}
      {key("left", "TV left", <ChevronLeft />, "col-start-1 row-start-2")}
      {key("select", "TV select", "OK", "col-start-2 row-start-2")}
      {key("right", "TV right", <ChevronRight />, "col-start-3 row-start-2")}
      {key("down", "TV down", <ChevronDown />, "col-start-2 row-start-3")}
    </div>
    <div className="grid grid-cols-3 gap-1">
      {tool("back", "Back", <ArrowLeft />)}
      {tool("home", "Home", <House />)}
      {tool("info", "Info", <Info />)}
    </div>
    {state && <div className="flex flex-wrap items-center justify-between gap-2">
      <PlaybackTransport state={state} credentials={credentials} connected={connected} run={run} />
      <PlaybackVolume state={state} connected={connected} run={run} />
    </div>}
    <p id={descriptionId} className={cn("text-sm text-muted-foreground", failed && connected && "text-destructive")} role="status">
      {!connected ? offline(state?.installationName) : failed ? `Didn't reach ${name}. Try again.` : "Arrow keys work here."}
    </p>
  </section>;
}
