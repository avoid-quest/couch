import { useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeviceCell, MixerKey, type Channel } from "@/components/MixerKeys";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import type { GroupMember } from "../../../shared/mixer-groups";
import type { Action, DeviceSummary } from "../../../shared/protocol";

export const said = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

/** A group being saved: a new one (no id) or an edit. */
export type GroupDraft = { id?: string; name: string; members: GroupMember[] };
/** What saving did, said as a message with its Undo (a deleted group comes back). */
type Outcome = { text: string; undo: () => Promise<void> };

/**
 * Saving a group, in the desk list's place: its name, then every device with its Sound and Picture keys, its members
 * first and offline ones too. Saving changes nothing that plays; Delete offers Undo.
 */
export function GroupEditor({
  state,
  connected,
  draft,
  onDone,
}: {
  state: ClientSessionState;
  connected: boolean;
  draft: GroupDraft;
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
  const ins = shown.filter((device) => draft.members.some((item) => item.deviceId === device.id)),
    outs = shown.filter((device) => !ins.includes(device));
  const row = (device: DeviceSummary) => {
    const member = members.find((item) => item.deviceId === device.id);
    const key = (channel: Channel) => (
      <MixerKey
        device={device}
        channel={channel}
        on={!!member?.[channel]}
        control={{ enabled: true }}
        onPress={() => flip(device.id, channel)}
      />
    );
    return (
      <li
        key={device.id}
        data-nav-row
        className="flex min-h-(--desk-row) min-w-0 items-center gap-1"
      >
        <span className="min-w-0 flex-1">
          <DeviceCell
            device={device}
            status={device.online ? undefined : "Offline"}
            active={!!member}
          />
        </span>
        {key("sound")}
        {key("picture")}
      </li>
    );
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-nav-row className="flex shrink-0 items-center gap-2 pt-1 pb-3">
        <Input
          aria-label="Group name"
          placeholder="Name this group"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          className="h-11 flex-1 rounded-full px-4 font-heading text-title font-semibold"
        />
      </div>
      <div className="min-h-0 flex-1 pb-3">
        {ins.length > 0 && (
          <ul aria-label="In this group" className="grid">
            {ins.map(row)}
          </ul>
        )}
        {outs.length > 0 && (
          <ul
            aria-label={ins.length ? "Not in this group" : "In this group"}
            className={ins.length > 0 ? "mt-1.5 grid border-t pt-1.5" : "grid"}
          >
            {outs.map(row)}
          </ul>
        )}
      </div>
      <div
        data-nav-row
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 pb-1"
      >
        <Button
          disabled={!connected || busy || !kept.length}
          onClick={() =>
            void save({ type: "saveGroup", group: { ...draft, name: saved, members: kept } }, () =>
              onDone(),
            )
          }
        >
          Save group
        </Button>
        <p className="order-first grid min-w-0 basis-full text-meta">
          <span className="font-semibold">Saving changes nothing that plays</span>
          <span className="text-muted-foreground">
            Groups are for everyone on this Couch. Each use checks again what every device lets
            others use.
          </span>
        </p>
        {draft.id && (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
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
        <Button variant="ghost" disabled={busy} onClick={() => onDone()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
