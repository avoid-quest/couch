import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, House, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NavigationKey } from "../../shared/protocol";
import { cn } from "@/lib/utils";
import { startHold } from "@/hold";

// Each arrow is a quarter of the ring, so a press anywhere on it counts, as on a remote's clickpad. It sits in its
// half of the ring, so its centre is its own, clipped to the quarter, with a mask that leaves a gap around OK
// (radius 22% of the ring's) so a focused quarter stays apart from it.
const quarters = {
  up: "inset-x-0 top-0 h-1/2 items-start [clip-path:polygon(0_0,100%_0,50%_100%)] [mask-image:radial-gradient(circle_farthest-side_at_50%_100%,transparent_44%,black_44.5%)]",
  right: "inset-y-0 right-0 h-auto w-1/2 justify-end [clip-path:polygon(100%_0,100%_100%,0_50%)] [mask-image:radial-gradient(circle_farthest-side_at_0_50%,transparent_44%,black_44.5%)]",
  down: "inset-x-0 bottom-0 h-1/2 items-end [clip-path:polygon(0_100%,100%_100%,50%_0)] [mask-image:radial-gradient(circle_farthest-side_at_50%_0,transparent_44%,black_44.5%)]",
  left: "inset-y-0 left-0 h-auto w-1/2 justify-start [clip-path:polygon(0_0,0_100%,100%_50%)] [mask-image:radial-gradient(circle_farthest-side_at_100%_50%,transparent_44%,black_44.5%)]",
};

/**
 * The remote's ring: four arrows around OK, then Back, Home and Info. The catalog has no direction pad, so it is
 * Buttons clipped to the ring's quarters around a round one. Arrow keys work while the ring has focus.
 */
export function RemotePad({ connected, onNavigate }: { connected: boolean; onNavigate: (key: NavigationKey) => Promise<boolean> }) {
  const navigate = (key: NavigationKey) => { if (connected) void onNavigate(key); };
  // OK held opens the focused item's menu on the TV, as a remote's held OK does; a short press is OK, sent on release.
  const ok = useRef<ReturnType<typeof startHold>>(null);
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
    className={cn("absolute rounded-none p-[9%] active:bg-foreground/15 [&_svg:not([class*='size-'])]:size-7", quarters[direction])}>{icon}</Button>;
  const button = (key: NavigationKey, label: string, icon: ReactNode) => <Button type="button" variant="outline" aria-label={`TV ${label}`} disabled={!connected} onClick={() => navigate(key)}
    className="h-16 touch:min-h-16 rounded-full text-base dark:bg-transparent active:bg-foreground/15 [&_svg:not([class*='size-'])]:size-5">{icon}{label}</Button>;
  return <div className="mx-auto grid w-full max-w-72 gap-6">
    <section data-remote-pad aria-label="TV directions" tabIndex={0} onKeyDown={keydown} className="relative aspect-square overflow-hidden rounded-full border">
      {arrow("up", <ChevronUp aria-hidden="true" />)}
      {arrow("right", <ChevronRight aria-hidden="true" />)}
      {arrow("down", <ChevronDown aria-hidden="true" />)}
      {arrow("left", <ChevronLeft aria-hidden="true" />)}
      <Button type="button" aria-label="TV OK" disabled={!connected} onPointerDown={event => { if (event.button === 0) ok.current = startHold(() => navigate("menu")); }} onPointerCancel={() => { ok.current?.release(); ok.current = null; }}
        // A press that leaves OK ends there, as a click released elsewhere does, so its hold can't fire after it.
        onPointerLeave={() => { ok.current?.release(); ok.current = null; }}
        onClick={() => { if (ok.current?.release() ?? true) navigate("select"); ok.current = null; }} className="absolute inset-[31%] h-auto rounded-full text-lg">OK</Button>
    </section>
    <div className="grid grid-cols-3 gap-2">
      {button("back", "Back", <ArrowLeft aria-hidden="true" />)}
      {button("home", "Home", <House aria-hidden="true" />)}
      {button("info", "Info", <Info aria-hidden="true" />)}
    </div>
    <p className="-mt-3 text-center text-xs text-muted-foreground touch:hidden">Arrow keys work on the pad.</p>
  </div>;
}
