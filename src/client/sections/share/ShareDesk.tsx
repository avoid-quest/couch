import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Level } from "@/components/Level";
import { busyWith, DeviceCell, MixerKey } from "@/components/MixerKeys";
import { RangeControl } from "@/components/RangeControl";
import { deviceId } from "@/session/device-id";
import type { LiveSharing } from "@/session/live";
import type { LiveRoute } from "@/session/live-route";
import type { ClientSessionState } from "@/session/session";
import { useSessionGate } from "@/session/session-context";
import { choiceRows, offlineNames } from "@/session/where-it-plays";
import { Folds, GuestRow } from "@/sections/shell/DeskRows";
import { ChoiceGroups } from "@/sections/shell/MixerGroups";
import { viewerLine, type Viewer } from "./share";

// The share's desk, on the device that shares (SharePlayer.tsx): its rows are who watches or listens and how, with the
// house's other screens and speakers one press away. The share's own Where it plays takes over once anyone plays it.

/**
 * A share nobody plays yet: "On no screens yet…", the groups, and every device that lends a screen or speakers, each
 * with its keys; turning one on, or using a group, plays the share there.
 */
export function ShareTargets({
  state,
  sharing,
}: {
  state: ClientSessionState;
  sharing: LiveSharing;
}) {
  const { run, connected } = useSessionGate();
  const source = sharing.source;
  const rows = choiceRows(state, { here: deviceId(), audioOnly: !source.video }).filter(
    (row) => row.device.id !== source.deviceId,
  );
  const usable = rows.filter(
    (row) => row.device.online && (row.picture.enabled || row.sound.enabled),
  );
  const play = (id: string, picture: boolean, sound: boolean) =>
    run({ type: "playLive", sourceId: source.id, deviceId: id, picture, sound });
  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between text-meta">
        <span className="font-semibold text-muted-foreground">Where it plays</span>
        <span className="text-subtle-foreground">0 of {rows.length + 1} devices</span>
      </div>
      <div className="-mx-2 min-h-0 shrink overflow-y-auto overscroll-contain px-2 [scrollbar-width:none]">
        <p className="pt-1 pb-3 text-meta text-subtle-foreground">
          On no {source.video ? "screens" : "speakers"} yet. Turn on a{" "}
          {source.video ? "screen or speakers" : "speaker"} below, or leave it in Shared sources for
          people to play.
        </p>
        <ChoiceGroups
          state={state}
          connected={connected}
          rows={
            source.audio
              ? rows
              : rows.map((row) => ({ ...row, sound: { enabled: false, reason: "No sound" } }))
          }
          choice={{}}
          onChoose={async (choice) => {
            // One device at a time: the first starts the share's playback and the others join it.
            for (const [id, { picture, sound }] of Object.entries(choice))
              if (!(await play(id, picture, sound))) return;
          }}
        />
        <h4 className="flex h-9 items-end border-t pb-1.5 text-caption text-subtle-foreground">
          Other devices
        </h4>
        <ul aria-label="Not playing" className="grid">
          {usable.map((row) => (
            <li
              key={row.device.id}
              data-nav-row
              className="flex min-h-(--desk-row) min-w-0 items-center gap-1"
            >
              <span className="min-w-0 flex-1 py-1">
                <DeviceCell
                  device={row.device}
                  status={row.status}
                  busy={
                    row.status.includes("Playing")
                      ? busyWith(state.playbacks, row.device.id)
                      : undefined
                  }
                />
              </span>
              <MixerKey
                device={row.device}
                channel="sound"
                on={false}
                control={source.audio ? row.sound : { enabled: false }}
                disabled={!connected}
                onPress={() => void play(row.device.id, false, true)}
              />
              {source.video && (
                <MixerKey
                  device={row.device}
                  channel="picture"
                  on={false}
                  control={row.picture}
                  disabled={!connected}
                  onPress={() => void play(row.device.id, true, false)}
                />
              )}
            </li>
          ))}
        </ul>
        <Folds
          folds={[
            {
              label: "Private now",
              names: offlineNames(
                rows.filter(
                  (row) => row.device.online && !row.picture.enabled && !row.sound.enabled,
                ),
              ),
            },
            { label: "Offline", names: offlineNames(rows.filter((row) => !row.device.online)) },
          ]}
        />
      </div>
    </>
  );
}

/**
 * The share's receivers in its other playbacks (one a receiver plays privately, say), as the desk lists them after the
 * selected playback's own: each device and how it gets the share.
 */
export function elsewhereRows(
  viewers: Viewer[],
  routes: Record<string, LiveRoute>,
  playbackId: string | null | undefined,
) {
  const others = viewers.filter((viewer) => viewer.playbackId !== playbackId);
  return {
    ids: others.map((viewer) => viewer.device.id),
    rows: others.map((viewer) => (
      <li
        key={viewer.device.id}
        data-nav-row
        className="flex min-h-(--desk-row) min-w-0 items-center gap-1"
      >
        <span className="min-w-0 flex-1 py-1">
          <DeviceCell
            device={viewer.device}
            status={viewerLine(viewer, routes[viewer.device.id])}
            failed={!!viewer.error}
            active
          />
        </span>
      </li>
    )),
  };
}

/**
 * Who listens to Live audio: the house's speakers that listen, each with its Sound key and level, then the people on
 * their own devices, whose details offer Remove. Opened, Add speakers lists the other speakers that lend their sound.
 */
export function LiveListeners({
  state,
  sharing,
  viewers,
  routes,
}: {
  state: ClientSessionState;
  sharing: LiveSharing;
  viewers: Viewer[];
  routes: Record<string, LiveRoute>;
}) {
  const { run, connected } = useSessionGate();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const here = deviceId();
  const lends = (id: string) =>
    id === here || !!state.devices?.find((device) => device.id === id)?.sharing?.audio;
  const speakers = viewers.filter((viewer) => lends(viewer.device.id));
  const guests = viewers.filter((viewer) => !lends(viewer.device.id));
  const others = (state.devices ?? []).filter(
    (device) =>
      device.online && lends(device.id) && !viewers.some((v) => v.device.id === device.id),
  );
  const offline = (state.devices ?? []).filter((device) => !device.online);
  const playing = (viewer: Viewer) =>
    viewer.playing &&
    viewer.state !== "joining" &&
    viewer.state !== "stalled" &&
    !viewer.error &&
    !viewer.device.muted &&
    viewer.device.volume > 0;
  const status = (viewer: Viewer) =>
    viewer.error
      ? viewer.error
      : viewer.state === "joining"
        ? "Joining"
        : viewer.state && viewer.state !== "playing"
          ? viewerLine(viewer, routes[viewer.device.id]).replace(/^Sound, /, "")
          : viewer.device.id === here
            ? "This device"
            : "";
  const Chevron = open ? ChevronDown : ChevronUp;
  return (
    <>
      <div className="-mx-2 flex h-10 shrink-0 items-center gap-1 text-meta">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-8 min-w-0 flex-1 items-center rounded-full px-2 text-left font-semibold text-muted-foreground outline-none hover:bg-(--fill) hover:text-foreground"
        >
          Who listens
        </button>
        <button
          type="button"
          aria-label={open ? "Show fewer devices" : "Show all devices"}
          onClick={() => setOpen(!open)}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2 whitespace-nowrap text-subtle-foreground outline-none hover:bg-(--fill) hover:text-foreground"
        >
          {viewers.length} listening
          <Chevron aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="-mx-2 min-h-0 shrink overflow-y-auto overscroll-contain px-2 [scrollbar-width:none]">
        {!viewers.length && (
          <p className="pt-1 pb-3 text-meta text-subtle-foreground">
            Nobody listens yet. People join from Shared sources; add speakers below.
          </p>
        )}
        <ul aria-label="Who listens" className="grid">
          {speakers.map((viewer) => (
            <li
              key={viewer.device.id}
              data-nav-row
              className="flex min-h-(--desk-row) min-w-0 items-center gap-1"
            >
              <span className="min-w-0 flex-1 py-1">
                <DeviceCell
                  device={viewer.device}
                  status={status(viewer)}
                  failed={!!viewer.error}
                  active
                  after={<Level moving={playing(viewer)} className="shrink-0 text-xs" />}
                />
              </span>
              <div className="mr-1 w-[5.25rem] shrink-0">
                <RangeControl
                  label={`${viewer.device.name} volume`}
                  value={viewer.device.volume}
                  max={100}
                  showValue={false}
                  disabled={!connected}
                  onCommit={(volume) => run({ type: "volume", volume, deviceId: viewer.device.id })}
                />
              </div>
              <MixerKey
                device={viewer.device}
                channel="sound"
                on
                control={{ enabled: true }}
                disabled={!connected}
                onPress={() =>
                  void run({
                    type: "removeLiveListener",
                    playbackId: viewer.playbackId,
                    deviceId: viewer.device.id,
                  })
                }
              />
            </li>
          ))}
          {guests.map((viewer) => (
            <GuestRow
              key={viewer.device.id}
              row={{
                device: viewer.device,
                status: status(viewer),
                failed: !!viewer.error,
                sounding: playing(viewer),
              }}
              open={details === viewer.device.id}
              onOpen={() => setDetails((id) => (id === viewer.device.id ? null : viewer.device.id))}
              onRemove={() =>
                void run({
                  type: "removeLiveListener",
                  playbackId: viewer.playbackId,
                  deviceId: viewer.device.id,
                })
              }
            />
          ))}
        </ul>
        {open && others.length > 0 && (
          <>
            <h4 className="mt-2 flex h-9 items-end border-t pb-1.5 text-caption text-subtle-foreground">
              Add speakers
            </h4>
            <ul aria-label="Add speakers" className="grid">
              {others.map((device) => (
                <li
                  key={device.id}
                  data-nav-row
                  className="flex min-h-(--desk-row) min-w-0 items-center gap-1"
                >
                  <span className="min-w-0 flex-1 py-1">
                    <DeviceCell
                      device={device}
                      status={device.id === here ? "This device" : undefined}
                    />
                  </span>
                  <MixerKey
                    device={device}
                    channel="sound"
                    on={false}
                    control={{ enabled: true }}
                    disabled={!connected}
                    onPress={() =>
                      void run({
                        type: "playLive",
                        sourceId: sharing.source.id,
                        deviceId: device.id,
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        {open && (
          <Folds
            folds={[
              { label: "Offline", names: offlineNames(offline.map((device) => ({ device }))) },
            ]}
          />
        )}
      </div>
    </>
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
