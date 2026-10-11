import { type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, House } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NavigationKey } from "../../shared/protocol";
import { cn } from "@/lib/utils";

export function RemotePad({ connected, onNavigate }: { connected: boolean; onNavigate: (key: NavigationKey) => Promise<boolean> }) {
  const navigate = (key: NavigationKey) => { if (connected) void onNavigate(key); };
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const keys: Record<string, NavigationKey> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Home: "home" };
    // Tab moves through the phone's controls; Enter/Space activate their native button once.
    const key = event.target === event.currentTarget && ["Enter", " "].includes(event.key) ? "select" : keys[event.key];
    if (!key) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) navigate(key);
  };
  const key = (direction: NavigationKey, label: string, icon: ReactNode, className: string) => <Button type="button" variant={direction === "select" ? "default" : "outline"} size="icon" className={cn("size-16 touch:size-16", className)} aria-label={label}
    disabled={!connected} onClick={() => navigate(direction)}>{icon}</Button>;
  return <section data-remote-pad className="grid gap-5 outline-none" aria-label="TV directions" tabIndex={0} onKeyDown={keydown}>
    <div className="mx-auto grid grid-cols-3 gap-2">
      {key("up", "TV up", <ChevronUp />, "col-start-2")}
      {key("left", "TV left", <ChevronLeft />, "col-start-1 row-start-2")}
      {key("select", "TV select", "OK", "col-start-2 row-start-2")}
      {key("right", "TV right", <ChevronRight />, "col-start-3 row-start-2")}
      {key("down", "TV down", <ChevronDown />, "col-start-2 row-start-3")}
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="min-h-11" disabled={!connected} onClick={() => navigate("back")}><ArrowLeft />TV Back</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={!connected} onClick={() => navigate("home")}><House />TV Home</Button>
    </div>
    <p className="text-sm text-muted-foreground">Arrow keys work on the pad. Tab moves through these controls.</p>
  </section>;
}
