import { useEffect, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DeviceCell, MixerKey, ProgrammeArt, busyWith, type Channel } from "@/components/MixerKeys";
import { closeChoose, useChooseRequest, type ChooseRequest } from "@/components/choose-view";
import { usePlayChoice } from "@/components/PlayOnPlaces";
import { cn } from "@/lib/utils";
import { ChoiceGroups } from "@/sections/shell/MixerGroups";
import { Folds } from "@/sections/shell/DeskRows";
import type { PlayerSide } from "@/sections/shell/player-side";
import { deviceId } from "@/session/device-id";
import { useOptionalSessionGate } from "@/session/session-context";
import {
  choiceRows,
  choiceSummary,
  firstChoice,
  offlineNames,
  type Choice,
  type ChoiceRow,
} from "@/session/where-it-plays";

/**
 * Choose where it plays, in the player's column with the page dimmed (the desk's sheet on a phone), from Play on's last
 * line: the item on one line, the groups, every device with the same keys, the sentence of what makes way, then Play
 * or Resume, and Cancel. Nothing plays until Play.
 */
export function ChooseLayer({ side, phone }: { side: PlayerSide; phone: boolean }) {
  const request = useChooseRequest();
  // Escape (a remote's Back) cancels it from anywhere while it is open, as the page under it is dimmed.
  useEffect(() => {
    if (!request || phone) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeChoose();
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [request, phone]);
  if (!request) return null;
  if (phone)
    return (
      <Sheet open onOpenChange={(open) => !open && closeChoose()}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          showCloseButton={false}
          className="now-playing max-h-[calc(100dvh-2.75rem)] gap-0 overflow-hidden rounded-t-[1.75rem] px-4 pt-4 pb-3"
        >
          <SheetTitle className="sr-only">Choose where it plays</SheetTitle>
          <Choose key={request.title} request={request} phone />
        </SheetContent>
      </Sheet>
    );
  return (
    <>
      <div
        aria-hidden="true"
        onClick={closeChoose}
        className="fixed inset-0 z-40 bg-[rgb(8_6_10/55%)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose where it plays"
        className={cn(
          "now-playing fixed top-3 bottom-3 z-40 flex w-(--side-player-width) flex-col justify-end",
          side === "left" ? "left-3" : "right-3",
        )}
      >
        <Choose key={request.title} request={request} />
      </div>
    </>
  );
}

function Choose({ request, phone = false }: { request: ChooseRequest; phone?: boolean }) {
  const session = useOptionalSessionGate();
  const state = session?.state;
  const rows = state ? choiceRows(state, { here: deviceId(), audioOnly: request.audioOnly }) : [];
  // What this device can play, as Play would; those rows lead, and keep their places while you choose.
  const [choice, setChoice] = useState<Choice>(() => firstChoice(rows));
  // What the last group asked that can't play now, said beside Play until the choice changes by hand.
  const [left, setLeft] = useState<string[]>([]);
  const play = usePlayChoice(request);
  const box = useRef<HTMLDivElement>(null);
  // It opens on the first key a press can change, never on Close or on Play.
  useEffect(() => {
    box.current
      ?.querySelector<HTMLElement>("button[data-mixer-key]")
      ?.focus({ preventScroll: true });
  }, []);
  if (!state || !session) return null;
  const connected = session.connected;
  const summary = choiceSummary(state, rows, choice);
  const usable = rows.filter(
    (row) => row.device.online && (row.picture.enabled || row.sound.enabled),
  );
  const privately = rows.filter(
    (row) => row.device.online && !row.picture.enabled && !row.sound.enabled,
  );
  const offline = rows.filter((row) => !row.device.online);
  const turn = (id: string, channel: Channel) => {
    setLeft([]);
    setChoice(({ [id]: was = { picture: false, sound: false }, ...others }) => {
      const now = { ...was, [channel]: !was[channel] };
      return now.picture || now.sound ? { ...others, [id]: now } : others;
    });
  };
  const verb = request.verb ?? "Play";
  // Where first, then what it changes for what plays now.
  const [lead, detail] = summary.ready
    ? [
        summary.lines.at(-1)?.replace(/^Plays/, verb === "Resume" ? "Resumes" : "Plays"),
        summary.lines.length > 1 ? summary.lines[0] : "",
      ]
    : [summary.lines[0], `Nothing plays until ${verb}.`];
  const device = (row: ChoiceRow) => {
    const chosen = choice[row.device.id];
    const on = (channel: Channel) => !!chosen?.[channel] && row[channel].enabled;
    const busy = busyWith(state.playbacks, row.device.id);
    const key = (channel: Channel) => (
      <MixerKey
        device={row.device}
        channel={channel}
        on={on(channel)}
        control={row[channel]}
        disabled={!connected}
        onPress={() => turn(row.device.id, channel)}
      />
    );
    return (
      <li
        key={row.device.id}
        data-nav-row
        className="flex min-h-(--desk-row) min-w-0 items-center gap-1"
      >
        <span className="min-w-0 flex-1 py-1">
          <DeviceCell
            device={row.device}
            status={row.status}
            busy={busy && row.status.includes("Playing") ? busy : undefined}
            active={!!chosen}
          />
        </span>
        {key("sound")}
        {!request.audioOnly && key("picture")}
      </li>
    );
  };
  return (
    <div ref={box} className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3.5 py-1 pr-3.5 pl-1">
        <ProgrammeArt
          thumbnail={request.thumbnail}
          title={request.title}
          className={cn(
            "shrink-0 rounded-lg object-cover shadow-[0_0.75rem_1.5rem_-0.75rem_rgb(0_0_0/80%)]",
            request.audioOnly ? "aspect-square w-22" : "aspect-video w-26",
          )}
        />
        <span className="grid min-w-0 gap-0.5">
          <b className="line-clamp-2 font-heading text-[1.0625rem] leading-[1.375rem] font-semibold">
            {request.title}
          </b>
          {request.detail && (
            <span className="truncate text-meta text-muted-foreground">{request.detail}</span>
          )}
        </span>
      </div>
      <section
        aria-label="Choose where it plays"
        className={cn(
          "flex min-h-0 flex-col",
          phone ? "mt-2" : "desk lit-panel mt-3 px-3.5 pt-1.5 pb-2",
        )}
      >
        <div className="flex h-10 shrink-0 items-center justify-between pl-0.5">
          <b className="font-heading text-[1.0625rem] font-semibold">Choose where it plays</b>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            title="Close"
            onClick={closeChoose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="-mx-2 min-h-0 shrink overflow-y-auto overscroll-contain px-2 [scrollbar-width:none]">
          <ChoiceGroups
            state={state}
            connected={connected}
            rows={rows}
            choice={choice}
            onChoose={(next, out) => {
              setChoice(next);
              setLeft(out);
            }}
          />
          <ul aria-label="Devices" className="grid">
            {usable.map(device)}
          </ul>
          <Folds
            folds={[
              { label: "Private now", names: offlineNames(privately) },
              { label: "Offline", names: offlineNames(offline) },
            ]}
          />
        </div>
        <div className="shrink-0 border-t pt-1">
          <p
            id="choose-where-it-plays-summary"
            role="status"
            className="grid gap-1 pt-2.5 pb-1 text-meta text-muted-foreground [overflow-wrap:anywhere]"
          >
            <span className="empty:hidden">
              {[detail, left.length > 0 && `Left out: ${left.join(", ")}.`]
                .filter(Boolean)
                .join(" ")}
            </span>
            <b className="font-semibold text-foreground">{lead}</b>
          </p>
          <div data-nav-row className="flex items-center gap-2 py-1.5">
            <Button
              disabled={!connected || !summary.ready}
              aria-describedby="choose-where-it-plays-summary"
              onClick={() => {
                closeChoose();
                play(choice);
              }}
            >
              <Play aria-hidden="true" className="fill-current" />
              {verb}
            </Button>
            <span className="flex-1" />
            <Button variant="ghost" onClick={closeChoose}>
              Cancel
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
