import { type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, House, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NavigationKey } from "../../shared/protocol";
import { cn } from "@/lib/utils";

// Each arrow is a quarter of the ring, so a press anywhere on it counts, as on a remote's clickpad. Its mask leaves a gap
// around OK (radius 38% of the ring's), so a focused quarter doesn't merge into it.
const quarters = {
  up: "[clip-path:polygon(0_0,100%_0,50%_50%)] items-start",
  right: "[clip-path:polygon(100%_0,100%_100%,50%_50%)] justify-end",
  down: "[clip-path:polygon(0_100%,100%_100%,50%_50%)] items-end",
  left: "[clip-path:polygon(0_0,0_100%,50%_50%)] justify-start",
};

/**
 * The remote's ring: four arrows around OK, then Back, Home and Info. The catalog has no direction pad, so it is
 * Buttons clipped to the ring's quarters around a round one. Arrow keys work while the ring has focus.
 */
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
  const arrow = (direction: keyof typeof quarters, icon: ReactNode) => <Button type="button" variant="ghost" aria-label={`TV ${direction}`} disabled={!connected} onClick={() => navigate(direction)}
    className={cn("absolute inset-0 size-full rounded-none p-[9%] [mask-image:radial-gradient(circle_closest-side,transparent_44%,black_44.5%)] active:bg-foreground/15 [&_svg:not([class*='size-'])]:size-7", quarters[direction])}>{icon}</Button>;
  const button = (key: NavigationKey, label: string, icon: ReactNode) => <Button type="button" variant="outline" aria-label={`TV ${label}`} disabled={!connected} onClick={() => navigate(key)}
    className="h-16 touch:min-h-16 rounded-full text-base dark:bg-transparent active:bg-foreground/15 [&_svg:not([class*='size-'])]:size-5">{icon}{label}</Button>;
  return <div className="mx-auto grid w-full max-w-72 gap-6">
    <section data-remote-pad aria-label="TV directions" tabIndex={0} onKeyDown={keydown} className="relative aspect-square overflow-hidden rounded-full border">
      {arrow("up", <ChevronUp aria-hidden="true" />)}
      {arrow("right", <ChevronRight aria-hidden="true" />)}
      {arrow("down", <ChevronDown aria-hidden="true" />)}
      {arrow("left", <ChevronLeft aria-hidden="true" />)}
      <Button type="button" aria-label="TV OK" disabled={!connected} onClick={() => navigate("select")} className="absolute inset-[31%] h-auto rounded-full text-lg">OK</Button>
    </section>
    <div className="grid grid-cols-3 gap-2">
      {button("back", "Back", <ArrowLeft aria-hidden="true" />)}
      {button("home", "Home", <House aria-hidden="true" />)}
      {button("info", "Info", <Info aria-hidden="true" />)}
    </div>
    <p className="-mt-3 text-center text-xs text-muted-foreground touch:hidden">Arrow keys work on the pad.</p>
  </div>;
}
