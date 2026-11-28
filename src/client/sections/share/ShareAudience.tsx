import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CircleAlert, MoreHorizontal, Plus, SlidersVertical, Volume2 } from "lucide-react";
import { Level } from "@/components/Level";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toolPanel } from "@/components/PlaybackTransport";
import { cn } from "@/lib/utils";
import type { LiveSharing } from "@/session/live";
import type { LiveRoute } from "@/session/live-route";
import { deviceId } from "@/session/device-id";
import { useSessionGate } from "@/session/session-context";
import { viewerLine, type Viewer } from "./share";

// Who gets a share and how, in its player (SharePlayer.tsx): its audience, Choose where it plays and Add speakers.

/** Watching, Listening or Listeners: each device, how it gets the share, and Live audio's Remove. */
export function Audience({
  sharing,
  viewers,
  routes,
  live,
  className,
}: {
  sharing: LiveSharing;
  viewers: Viewer[];
  routes: Record<string, LiveRoute>;
  live: boolean;
  className?: string;
}) {
  const { run, connected } = useSessionGate();
  const list = useRef<HTMLUListElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const picture = !!sharing.source.video;
  const heading = live ? "Listeners" : picture ? "Watching" : "Listening";
  const trouble = viewers.filter(
    (viewer) => viewer.error || viewer.state === "behind" || viewer.state === "stalled",
  ).length;
  const relayed = viewers.some((viewer) => viewer.state === "relayed");
  return (
    <div className={cn("mt-3.5 flex flex-col border-t pt-2", className)}>
      <div className="flex min-h-8 items-center gap-2">
        <h3 className="font-heading text-sm font-semibold">{heading}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {viewers.length > 0 && `${viewers.length}${trouble ? `, ${trouble} with trouble` : ""}`}
        </span>
        <span className="flex-1" />
        {live && <AddSpeakers sharing={sharing} viewers={viewers} />}
      </div>
      <ul
        ref={list}
        tabIndex={-1}
        aria-label={heading}
        className="-mx-1 grid min-h-0 content-start overflow-y-auto px-1 outline-none"
      >
        {viewers.map((viewer) => (
          <li
            key={viewer.device.id}
            className="flex min-h-11 items-center gap-2 border-b border-border/60 py-1 last:border-b-0"
          >
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm" title={viewer.device.name}>
                {viewer.device.id === deviceId()
                  ? `${viewer.device.name}, this device`
                  : viewer.device.name}
              </span>
              <span
                role={viewer.error ? "alert" : undefined}
                className={cn(
                  "text-xs [overflow-wrap:anywhere]",
                  viewer.error ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {viewer.error && (
                  <CircleAlert
                    aria-hidden="true"
                    className="mr-1 inline size-[1.1em] -translate-y-px text-destructive"
                  />
                )}
                {viewerLine(viewer, routes[viewer.device.id])}
              </span>
            </span>
            {viewer.sound && (
              <Level
                moving={
                  viewer.playing &&
                  viewer.state !== "joining" &&
                  viewer.state !== "stalled" &&
                  !viewer.error &&
                  !viewer.device.muted &&
                  viewer.device.volume > 0
                }
                className="text-muted-foreground"
              />
            )}
            {live && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!connected || pending === viewer.device.id}
                    aria-label={`Options for ${viewer.device.name}`}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  data-tv-local-only
                  align="end"
                  onCloseAutoFocus={(event) => {
                    if (pending !== viewer.device.id) return;
                    event.preventDefault();
                    list.current?.focus();
                  }}
                >
                  <DropdownMenuItem
                    onSelect={() => {
                      setPending(viewer.device.id);
                      void run({
                        type: "removeLiveListener",
                        playbackId: viewer.playbackId,
                        deviceId: viewer.device.id,
                      }).finally(() => setPending(null));
                    }}
                  >
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        ))}
      </ul>
      {!viewers.length && (
        <div className="grid justify-items-start gap-2 pt-1">
          <p role="status" className="text-xs text-muted-foreground">
            {live
              ? "No listeners yet. People join from Home, under Shared sources."
              : `Still sharing, on no ${picture ? "screens" : "speakers"}. It waits in Shared sources for anyone to play.`}
          </p>
          {!live && <ChooseWhere sharing={sharing} />}
        </div>
      )}
      {relayed && (
        <p className="pt-2 text-xs text-muted-foreground">
          {sharing.relay ? (
            "A device playing through Couch couldn't connect directly, even through the relay."
          ) : (
            <>
              A device playing through Couch couldn't connect directly. A relay can fix that, in{" "}
              <Link
                to="/settings/couch/devices"
                className="text-foreground underline underline-offset-4"
              >
                Devices &amp; network
              </Link>
              .
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Choose where it plays, for a share nobody plays yet: Play on the device that shares, which never plays its own share,
 * so Core waits in Where it plays and nothing starts until a picture or a sound is chosen there.
 */
export function ChooseWhere({ sharing, icon = false }: { sharing: LiveSharing; icon?: boolean }) {
  const { run, connected } = useSessionGate();
  const label = "Choose where it plays";
  return (
    <Button
      variant={icon ? "ghost" : "secondary"}
      size={icon ? "icon" : "sm"}
      className={icon ? "-mr-1.5 -mt-1 size-8" : "rounded-full"}
      disabled={!connected}
      aria-label={label}
      title={label}
      onClick={() =>
        void run({
          type: "playLive",
          sourceId: sharing.source.id,
          deviceId: sharing.source.deviceId,
        })
      }
    >
      <SlidersVertical aria-hidden="true" />
      {!icon && label}
    </Button>
  );
}

/**
 * Add speakers, for Live audio's operator: every speaker that lends its sound, this computer's own included (an input
 * is never held out of its share), each turned on or off at once. People on their phones join by themselves.
 */
export function AddSpeakers({
  sharing,
  viewers,
  icon = false,
}: {
  sharing: LiveSharing;
  viewers: Viewer[];
  icon?: boolean;
}) {
  const { state, run, connected } = useSessionGate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const here = deviceId();
  const devices = (state?.devices ?? []).filter((device) => device.online);
  const label = "Add speakers";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size={icon ? "icon" : "sm"}
          className={icon ? "-mr-1.5 -mt-1 size-8" : "-mr-2 h-8 text-xs"}
          aria-label={label}
          title={label}
        >
          {icon ? <SlidersVertical aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {!icon && label}
        </Button>
      </PopoverTrigger>
      {open && (
        <PopoverContent
          {...toolPanel(trigger.current)}
          data-tv-local-only
          aria-label="Speakers that listen"
          className="max-h-(--radix-popover-content-available-height) w-[min(24rem,calc(100vw-2rem))] gap-2 overflow-y-auto p-3"
        >
          <p className="font-heading text-base font-semibold">Speakers that listen</p>
          <p className="text-xs text-muted-foreground">
            A speaker that lends its sound can listen too. People on their phones join by
            themselves, from Home.
          </p>
          <ul className="grid">
            {devices.map((device) => {
              const viewer = viewers.find((item) => item.device.id === device.id);
              const lends = device.id === here || !!device.sharing?.audio;
              return (
                <li key={device.id} className="flex min-h-11 items-center gap-2 border-t py-1">
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm">{device.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {device.id === here
                        ? "This device"
                        : !lends
                          ? "Private"
                          : viewer
                            ? "Listening"
                            : ""}
                    </span>
                  </span>
                  <Button
                    variant={viewer ? "default" : "secondary"}
                    size="icon"
                    className="rounded-full"
                    aria-pressed={!!viewer}
                    aria-label={`Sound on ${device.name}`}
                    title={lends ? `Sound on ${device.name}` : "Private"}
                    disabled={!connected || !lends || pending === device.id}
                    onClick={() => {
                      setPending(device.id);
                      void run(
                        viewer
                          ? {
                              type: "removeLiveListener",
                              playbackId: viewer.playbackId,
                              deviceId: device.id,
                            }
                          : { type: "playLive", sourceId: sharing.source.id, deviceId: device.id },
                      ).finally(() => setPending(null));
                    }}
                  >
                    <Volume2 aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      )}
    </Popover>
  );
}

/** Each receiver's route, as its connection selected it, read every two seconds while the player shows the share. */
export function useRoutes(sharing: LiveSharing | null) {
  const { liveSharing } = useSessionGate();
  const [routes, setRoutes] = useState<Record<string, LiveRoute>>({});
  const pcm = sharing?.source.audioDelivery === "pcm";
  useEffect(() => {
    if (!sharing || pcm) return;
    let live = true;
    const read = () =>
      void liveSharing.routes().then((next) => {
        if (live) setRoutes(next);
      });
    read();
    const timer = setInterval(read, 2_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [liveSharing, sharing?.source.id, pcm]);
  return routes;
}
