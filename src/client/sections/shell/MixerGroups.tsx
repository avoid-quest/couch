import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Check, Lock, Minus, Pencil, Plus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import type { Row } from "@/session/where-it-plays";
import {
  applySteps,
  channelNames,
  groupStatus,
  listed,
  membersOf,
  planGroup,
  undoSteps,
  type Change,
  type Plan,
} from "@/session/groups";
import type { MixerGroup } from "../../../shared/mixer-groups";
import { GroupEditor, said, type GroupDraft, type Outcome } from "./GroupEditor";

const Groups = createContext<{
  edit: (draft: GroupDraft) => void;
  outcome: Outcome | null;
  say: (outcome: Outcome | null) => void;
} | null>(null);

/**
 * The open Mixer's groups: saving one takes the Mixer's place until it saves or cancels, and the last outcome stays
 * until the next. Both go when the panel closes.
 */
export function GroupsScope({
  state,
  connected,
  close,
  children,
}: {
  state: ClientSessionState;
  connected: boolean;
  close?: ReactNode;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState<GroupDraft | null>(null);
  const [outcome, say] = useState<Outcome | null>(null);
  const edit = (draft: GroupDraft) => {
    say(null);
    setEditing(draft);
  };
  return (
    <Groups value={{ edit, outcome, say }}>
      {editing ? (
        <GroupEditor
          state={state}
          connected={connected}
          draft={editing}
          close={close}
          onDone={(next) => {
            setEditing(null);
            say(next ?? null);
          }}
        />
      ) : (
        children
      )}
    </Groups>
  );
}

/** Who may save groups: the host and admins, as Core checks (settings-scope.ts reads it the same way). */
function useCanSave() {
  const gate = useContext(SessionGateContext);
  const host = gate?.identity ? gate.identity.authority === "host" : !!gate?.localHost;
  return host || gate?.identity?.authority === "administrator";
}

/**
 * The Mixer's Groups line: a chip per group, ✓ while it plays as saved and "5 of 6" while only part of it can; then,
 * for the host and admins, Save as group. Opening a chip shows what applying it would change, before anything does.
 */
export function GroupChips({
  state,
  connected,
  rows,
}: {
  state: ClientSessionState;
  connected: boolean;
  rows: Row[];
}) {
  const scope = useContext(Groups);
  const gate = useContext(SessionGateContext);
  const canSave = useCanSave();
  const [opened, setOpened] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const chips = useRef<HTMLDivElement>(null);
  const groups = state.groups ?? [];
  if (!scope || (!groups.length && !canSave)) return null;
  const { edit, outcome, say } = scope;
  const open = groups.find((group) => group.id === opened);
  const undo = async (current: Outcome) => {
    setUndoing(true);
    try {
      await current.undo();
      say(null);
      // Focus goes back where it came from rather than to the top of a TV's Sheet.
      const chip =
        chips.current?.querySelector<HTMLElement>(`[data-group="${current.group}"]`) ??
        chips.current?.querySelector<HTMLElement>("button");
      chip?.focus();
    } catch (error) {
      gate?.setError(said(error));
    } finally {
      setUndoing(false);
    }
  };
  return (
    <div className="grid gap-2 pb-2">
      <div
        ref={chips}
        data-nav-row
        role="group"
        aria-label="Groups"
        className="flex flex-wrap items-center gap-1.5"
      >
        {groups.map((group) => {
          const status = groupStatus(planGroup(group, rows, state));
          return (
            <Button
              key={group.id}
              data-group={group.id}
              variant="secondary"
              size="sm"
              aria-expanded={group.id === opened}
              onClick={() => {
                say(null);
                setOpened(group.id === opened ? null : group.id);
              }}
            >
              {status.on && <Check aria-hidden="true" />}
              {group.name}
              {status.part && (
                <span className="text-muted-foreground tabular-nums">{status.part}</span>
              )}
            </Button>
          );
        })}
        {canSave && (
          <Button
            variant="outline"
            size="sm"
            disabled={!connected}
            onClick={() => edit({ name: "", members: membersOf(rows) })}
          >
            <Plus aria-hidden="true" />
            Save as group
          </Button>
        )}
      </div>
      {outcome && (
        <div data-nav-row className="flex min-h-10 items-center gap-3">
          <p role="status" className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            {outcome.text}
          </p>
          <Button
            variant="ghost"
            size="sm"
            autoFocus
            disabled={!connected || undoing}
            onClick={() => void undo(outcome)}
          >
            Undo
          </Button>
        </div>
      )}
      {open && (
        <GroupPreview
          key={open.id}
          group={open}
          plan={planGroup(open, rows, state)}
          rows={rows}
          playbackId={state.player.playbackId}
          connected={connected}
          onEdit={canSave ? () => edit(open) : undefined}
          onApplied={(next) => {
            setOpened(null);
            say(next);
          }}
        />
      )}
    </div>
  );
}

/** One line of a group's preview: what it does to a device's picture or sound. */
const line = (key: string, icon: ReactNode, text: ReactNode, quiet = false) => (
  <li
    key={key}
    className={cn(
      "flex items-baseline gap-2 text-sm [overflow-wrap:anywhere]",
      quiet ? "text-muted-foreground" : "text-foreground/80",
    )}
  >
    <span className="translate-y-0.5 text-muted-foreground [&_svg]:size-3.5">{icon}</span>
    <span>{text}</span>
  </li>
);

/** What applying a group to this playback would do, line by line, with Apply under it. */
function GroupPreview({
  group,
  plan,
  rows,
  playbackId,
  connected,
  onEdit,
  onApplied,
}: {
  group: MixerGroup;
  plan: Plan;
  rows: Row[];
  playbackId: string | null;
  connected: boolean;
  onEdit?: () => void;
  onApplied: (outcome: Outcome) => void;
}) {
  const gate = useContext(SessionGateContext);
  const [busy, setBusy] = useState(false);
  const name = (text: string) => <span className="text-foreground">{text}</span>;
  const lines = [
    ...plan.same.map((item) =>
      line(
        `same:${item.deviceId}:${item.channel}`,
        <Check />,
        <>
          {name(item.name)} {item.channel}
        </>,
      ),
    ),
    ...plan.changes.map((item) =>
      line(
        `change:${item.deviceId}:${item.channel}`,
        item.on ? <Plus /> : <Minus />,
        <>
          {name(item.name)} {item.channel}
          {item.on ? (item.from ? `, taking it from ${item.from}` : "") : " stops"}
        </>,
      ),
    ),
    ...plan.left.map((item) =>
      line(
        `left:${item.deviceId}:${item.channel}`,
        item.reason === "offline" ? <WifiOff /> : <Lock />,
        <>
          {name(item.name)} {item.channel}: {item.reason},{" "}
          {item.stays ? "stays as it is" : "left out"}
        </>,
        true,
      ),
    ),
  ];
  const count = plan.changes.length;
  const outcome = count
    ? `${count} ${count === 1 ? "change" : "changes"}${plan.left.length ? `, ${plan.left.length} left as ${plan.left.length === 1 ? "it is" : "they are"}` : ""}`
    : !plan.same.length
      ? "None of it can play here now."
      : plan.left.length
        ? "Everything it may change is already on."
        : "It already plays like this.";
  const apply = async () => {
    if (!gate || !playbackId) return;
    setBusy(true);
    gate.setError(null);
    const applied: Change[] = [],
      refused: string[] = [];
    let reason: unknown;
    for (const step of applySteps(plan, rows, playbackId)) {
      // While nothing of the group plays yet, what plays now stays, so the playback never goes silent.
      if (!step.gains && !plan.same.length && !applied.some((change) => change.on)) break;
      try {
        for (const action of step.actions) await gate.command(action);
        applied.push(...step.changes);
      } catch (error) {
        reason = error;
        refused.push(...channelNames(step.changes).map((text) => `${text} (couldn't change)`));
      }
    }
    setBusy(false);
    if (!applied.length) {
      gate.setError(said(reason));
      return;
    }
    const except = [
      ...plan.left.map(
        (item) => `${channelNames([item])[0]} (${item.reason}${item.stays ? ", still on" : ""})`,
      ),
      ...refused,
    ];
    // Undo puts back this playback's devices; a device taken from another programme doesn't return to it.
    const steps = undoSteps(applied, rows, playbackId);
    const moved = applied.some((change) => change.from);
    onApplied({
      group: group.id,
      text: `${group.name} applied${except.length ? `, except ${listed(except)}` : ""}.${moved ? " Undo changes only this playback." : ""}`,
      undo: async () => {
        for (const step of steps) for (const action of step.actions) await gate.command(action);
      },
    });
  };
  return (
    <section aria-label={group.name} className="grid gap-2 border-y py-3">
      <div data-nav-row className="flex min-h-10 items-center gap-2">
        <h3 className="min-w-0 flex-1 text-base font-medium [overflow-wrap:anywhere]">
          {group.name}
        </h3>
        {onEdit && (
          <Button variant="ghost" size="sm" disabled={!connected} onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        )}
      </div>
      <ul className="grid gap-1">{lines}</ul>
      <div data-nav-row className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
        <Button
          size="sm"
          disabled={!connected || !count || busy || !playbackId}
          onClick={() => void apply()}
        >
          Apply
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {outcome}
        </span>
      </div>
    </section>
  );
}
