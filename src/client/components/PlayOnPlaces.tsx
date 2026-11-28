import type { ReactNode } from "react";
import { busyWith, ProgrammeArt } from "@/components/MixerKeys";
import { openChoose, type ChooseRequest } from "@/components/choose-view";
import { groupChoice } from "@/session/groups";
import { deviceId } from "@/session/device-id";
import { useOptionalSessionGate } from "@/session/session-context";
import type { ClientSessionState } from "@/session/session";
import {
  choiceRows,
  choiceSummary,
  firstChoice,
  playOnOf,
  type Choice,
  type ChoiceRow,
} from "@/session/where-it-plays";

// Play on: a short list of places hanging from its control (an item's menu, a page's header, the destination beside
// Resume). One press plays there and says so with Undo; "Picture and sound separately…" opens Choose where it plays.

/** What a place list plays: the item, its Play's word, and the request that plays it. */
export type PlaceItem = Omit<ChooseRequest, "from">;

/**
 * Plays a choice and says where, with what made way, and an Undo that puts it back (made-way.ts): "Resumed on Living
 * room. Blob keeps playing on 3 other devices."
 */
export function usePlayChoice(item: PlaceItem) {
  const gate = useOptionalSessionGate();
  return (choice: Choice, place?: string) => {
    const state = gate?.state;
    if (!gate || !state) return;
    const rows = choiceRows(state, { here: deviceId(), audioOnly: item.audioOnly });
    const on = playOnOf(rows, choice);
    if (!on) return;
    const summary = choiceSummary(state, rows, choice);
    const where = summary.lines.at(-1) ?? "";
    const done = item.verb === "Resume" ? "Resumed" : "Playing";
    const said = place ? `${done} on ${place}.` : where.replace(/^Plays on/, `${done} on`);
    const changes = summary.lines.length > 1 ? ` ${summary.lines[0]}` : "";
    void gate.takeWithUndo(
      async () => {
        item.onPlay(on);
      },
      `${said}${changes}`,
      true,
    );
  };
}

type Place = {
  key: string;
  label: string;
  /** What it plays now, or this device's own name. */
  note?: ReactNode;
  choice: Choice;
  /** The words the message names it by. */
  place: string;
};

/** The places an item can play: this device, the groups that can play it, then every online device that lends something. */
function placesOf(state: ClientSessionState, audioOnly = false): Place[] {
  const here = deviceId();
  const rows = choiceRows(state, { here, audioOnly });
  const usable = (row: ChoiceRow) =>
    row.device.online && (row.picture.enabled || row.sound.enabled);
  const only = (row: ChoiceRow): Choice => ({
    [row.device.id]: { picture: row.picture.enabled, sound: row.sound.enabled },
  });
  const busy = (row: ChoiceRow) => {
    const playback = busyWith(state.playbacks, row.device.id);
    return (
      playback && (
        <>
          {!playback.private && (
            <ProgrammeArt
              thumbnail={playback.thumbnail}
              title={playback.title ?? ""}
              className="size-[1.125rem] shrink-0 rounded-[0.1875rem] object-cover"
            />
          )}
          <span className="truncate">{playback.private ? "Private" : playback.title}</span>
        </>
      )
    );
  };
  const mine = rows.filter((row) => row.mine && usable(row));
  const groups = (state.groups ?? []).flatMap((group) => {
    const { choice } = groupChoice(group, rows);
    const count = Object.keys(choice).length;
    if (!count) return [];
    const wanted = group.members.length;
    return [
      {
        key: `group:${group.id}`,
        label: group.name,
        note: (
          <span className="truncate">
            {count < wanted
              ? `${count} of ${wanted} devices`
              : count === 1
                ? "1 device"
                : `${count} devices`}
          </span>
        ),
        choice,
        place: group.name,
      },
    ];
  });
  return [
    ...mine.map((row) => ({
      key: row.device.id,
      label: "This device",
      note: busy(row) || <span className="truncate">{row.device.name}</span>,
      choice: firstChoice(rows),
      place: "this device",
    })),
    ...groups,
    ...rows
      .filter((row) => !row.mine && usable(row))
      .map((row) => ({
        key: row.device.id,
        label: row.device.name,
        note: busy(row),
        choice: only(row),
        place: row.device.name,
      })),
  ];
}

/**
 * The list's rows, drawn by `row` (a menu's items, a Sheet's or a panel's buttons): "Play on" or "Resume on" over them,
 * This device, the groups, each device with what it plays, and "Picture and sound separately…" last.
 */
export function PlaceRows({
  item,
  from,
  row,
  heading,
  separator,
  onDone,
}: {
  item: PlaceItem;
  /** What the focus returns to once Choose where it plays closes. */
  from: () => HTMLElement | null;
  row: (key: string, onSelect: () => void, children: ReactNode) => ReactNode;
  heading: (text: string) => ReactNode;
  separator: (key: string) => ReactNode;
  /** The list closes: `handOff` while Choose where it plays takes the focus from there. */
  onDone?: (handOff?: boolean) => void;
}) {
  const state = useOptionalSessionGate()?.state;
  const play = usePlayChoice(item);
  if (!state) return null;
  const places = placesOf(state, item.audioOnly);
  const content = (place: Place) => (
    <span className="flex w-full min-w-0 items-center justify-between gap-4">
      <span className="min-w-0 truncate">{place.label}</span>
      {place.note && (
        <span className="flex max-w-1/2 min-w-0 items-center gap-1.5 text-meta text-subtle-foreground in-data-highlighted:text-inherit">
          {place.note}
        </span>
      )}
    </span>
  );
  const groups = places.filter((place) => place.key.startsWith("group:"));
  const here = places.filter((place) => place.label === "This device");
  const devices = places.filter((place) => !groups.includes(place) && !here.includes(place));
  const select = (place: Place) => () => {
    onDone?.();
    play(place.choice, place.place);
  };
  return (
    <>
      {heading(item.verb === "Resume" ? "Resume on" : "Play on")}
      {here.map((place) => row(place.key, select(place), content(place)))}
      {groups.length > 0 && separator("groups")}
      {groups.map((place) => row(place.key, select(place), content(place)))}
      {devices.length > 0 && separator("devices")}
      {devices.map((place) => row(place.key, select(place), content(place)))}
      {separator("apart")}
      {row(
        "apart",
        () => {
          const opener = from();
          onDone?.(true);
          // Once what opened the list has its focus back, so the column takes it from there.
          requestAnimationFrame(() => openChoose({ ...item, from: opener }));
        },
        <span>Picture and sound separately…</span>,
      )}
    </>
  );
}
