import { useContext, useState, type ReactNode } from "react";
import { Monitor, MonitorOff, Volume2, VolumeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import type { GroupMember } from "../../../shared/mixer-groups";
import type { Action } from "../../../shared/protocol";
import type { Row } from "@/session/where-it-plays";

export const said = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

/** A group being saved: a new one (no id) or an edit. */
export type GroupDraft = { id?: string; name: string; members: GroupMember[] };
/**
 * What the last group action did, said beside the groups with its Undo: a toast would sit under a phone's or TV's Sheet.
 * `group` is the chip focus returns to after Undo.
 */
/** A change's line beside the chips; Undo gets the Mixer's rows as they are when it is pressed. */
export type Outcome = { text: string; undo: (rows: Row[]) => Promise<void>; group?: string };

/**
 * Saving a group, in the Mixer's place: its name, then every device with its Picture and Sound, offline ones too.
 * Saving changes nothing that plays; Delete offers Undo.
 */
export function GroupEditor({
  state,
  connected,
  draft,
  close,
  onDone,
}: {
  state: ClientSessionState;
  connected: boolean;
  draft: GroupDraft;
  close?: ReactNode;
  onDone: (outcome?: Outcome) => void;
}) {
  const gate = useContext(SessionGateContext);
  const [name, setName] = useState(draft.name);
  const [members, setMembers] = useState(draft.members);
  const [busy, setBusy] = useState(false);
  // Its devices first, in the order taken as it opens, so rows stay put while you change them; new ones go last.
  const [order] = useState(() =>
    (state.devices ?? [])
      .map((device) => device.id)
      .sort(
        (a, b) =>
          Number(!draft.members.some((item) => item.deviceId === a)) -
          Number(!draft.members.some((item) => item.deviceId === b)),
      ),
  );
  const place = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const shown = [...(state.devices ?? [])].sort((a, b) => place(a.id) - place(b.id));
  const flip = (deviceId: string, channel: "picture" | "sound") =>
    setMembers((current) => {
      const member = current.find((item) => item.deviceId === deviceId) ?? {
        deviceId,
        picture: false,
        sound: false,
      };
      const next = { ...member, [channel]: !member[channel] };
      const rest = current.filter((item) => item.deviceId !== deviceId);
      return next.picture || next.sound ? [...rest, next] : rest;
    });
  // Only paired devices: one forgotten since stays out of the group when it saves again.
  const kept = members.filter((member) =>
    state.devices?.some((device) => device.id === member.deviceId),
  );
  const save = async (action: Action, done: () => void) => {
    if (!gate) return;
    setBusy(true);
    try {
      await gate.command(action);
      done();
    } catch (error) {
      gate.setError(said(error));
    } finally {
      setBusy(false);
    }
  };
  const saved = name.trim() || "New group";
  const toggle = (
    deviceName: string,
    on: boolean,
    channel: "picture" | "sound",
    deviceId: string,
  ) => (
    <Toggle
      aria-label={`${deviceName} ${channel}`}
      title={channel === "picture" ? "Picture" : "Sound"}
      pressed={on}
      onPressedChange={() => flip(deviceId, channel)}
      className="size-11 data-[state=off]:text-muted-foreground data-[state=on]:bg-transparent"
    >
      {channel === "picture" ? (
        on ? (
          <Monitor aria-hidden="true" />
        ) : (
          <MonitorOff aria-hidden="true" />
        )
      ) : on ? (
        <Volume2 aria-hidden="true" />
      ) : (
        <VolumeOff aria-hidden="true" />
      )}
    </Toggle>
  );
  return (
    <>
      <div className={cn("grid shrink-0 gap-1 pb-2", close && "sticky top-0 z-10 bg-inherit pt-2")}>
        <div data-nav-row className="flex min-h-11 items-center gap-2">
          <Input
            aria-label="Group name"
            placeholder="Name this group"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            className="flex-1"
          />
          {close}
        </div>
      </div>
      <div className="-mx-3 min-h-0 overflow-y-auto overscroll-contain px-3">
        <ul aria-label="In this group" className="grid">
          {shown.map((device) => {
            const member = members.find((item) => item.deviceId === device.id);
            return (
              <li
                key={device.id}
                data-nav-row
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1 py-1"
              >
                <span className="grid min-w-0 py-1">
                  <span className="text-base [overflow-wrap:anywhere]">{device.name}</span>
                  {!device.online && <span className="text-sm text-muted-foreground">Offline</span>}
                </span>
                {toggle(device.name, !!member?.picture, "picture", device.id)}
                {toggle(device.name, !!member?.sound, "sound", device.id)}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="grid shrink-0 gap-2 border-t pt-3">
        <p className="text-sm text-muted-foreground">
          Saving changes nothing that plays. Groups are for everyone on this Couch, and each use
          checks again what every device lets others use.
        </p>
        <div data-nav-row className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!connected || busy || !kept.length}
            onClick={() =>
              void save(
                { type: "saveGroup", group: { ...draft, name: saved, members: kept } },
                () => onDone(),
              )
            }
          >
            Save group
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => onDone()}>
            Cancel
          </Button>
          {draft.id && (
            <Button
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              disabled={!connected || busy}
              onClick={() =>
                void save({ type: "deleteGroup", id: draft.id! }, () =>
                  onDone({
                    text: `${draft.name} deleted.`,
                    undo: () => gate!.command({ type: "saveGroup", group: draft }),
                  }),
                )
              }
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
