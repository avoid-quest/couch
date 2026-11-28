import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { Check, Lock, Minus, Pencil, Plus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import type { Choice, ChoiceRow, Row } from "@/session/where-it-plays";
import {
  applySteps,
  channelNames,
  groupChoice,
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
 * The Groups line: "Groups", a chip per group (✓ while it plays as saved, "5 of 6" while only part of it can, the open
 * one inverted), then, for the host and admins, Save as group; the last group action's outcome and Undo under it.
 */
function GroupLine({
  chips,
  connected,
  onSave,
  outcome,
  undoing,
  onUndo,
  lineRef,
}: {
  chips: {
    group: MixerGroup;
    on: boolean;
    part?: string;
    open?: boolean;
    onClick: () => void;
  }[];
  connected: boolean;
  onSave?: () => void;
  outcome: Outcome | null;
  undoing: boolean;
  onUndo: (outcome: Outcome) => void;
  lineRef?: Ref<HTMLDivElement>;
}) {
  return (
    <>
      <div
        ref={lineRef}
        data-nav-row
        role="group"
        aria-label="Groups"
        className="flex flex-wrap items-center gap-1.5 pb-2.5"
      >
        <span aria-hidden="true" className="mr-1 text-meta text-muted-foreground">
          Groups
        </span>
        {chips.map(({ group, on, part, open, onClick }) => (
          <Button
            key={group.id}
            data-group={group.id}
            variant="secondary"
            size="sm"
            aria-expanded={open}
            onClick={onClick}
            className="font-semibold aria-expanded:bg-foreground aria-expanded:text-background aria-expanded:[&_.text-muted-foreground]:text-background/70"
          >
            {on && <Check aria-hidden="true" />}
            {group.name}
            {part && <span className="font-normal text-muted-foreground tabular-nums">{part}</span>}
          </Button>
        ))}
        {onSave && (
          <Button
            variant="outline"
            size="sm"
            disabled={!connected}
            onClick={onSave}
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus aria-hidden="true" />
            Save as group
          </Button>
        )}
      </div>
      {outcome && (
        <div data-nav-row className="flex min-h-10 items-center gap-3 pb-2">
          <p role="status" className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            {outcome.text}
          </p>
          <Button
            variant="ghost"
            size="sm"
            autoFocus
            disabled={!connected || undoing}
            onClick={() => onUndo(outcome)}
          >
            Undo
          </Button>
        </div>
      )}
    </>
  );
}

/** The scope's outcome with its Undo, which puts back what changed and returns focus to the chip it came from. */
function useUndo(chips: RefObject<HTMLDivElement | null>, rows: Row[]) {
  const scope = useContext(Groups);
  const gate = useContext(SessionGateContext);
  const [undoing, setUndoing] = useState(false);
  const undo = async (current: Outcome) => {
    setUndoing(true);
    try {
      await current.undo(rows);
      scope?.say(null);
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
  return { undoing, undo: (current: Outcome) => void undo(current) };
}

/**
 * The Mixer's Groups line. Opening a chip shows what applying it to this playback (`title`) would change, before
 * anything does.
 */
export function GroupChips({
  state,
  connected,
  rows,
  title,
}: {
  state: ClientSessionState;
  connected: boolean;
  rows: Row[];
  title?: string | null;
}) {
  const scope = useContext(Groups);
  const canSave = useCanSave();
  const [opened, setOpened] = useState<string | null>(null);
  const chips = useRef<HTMLDivElement>(null);
  const { undoing, undo } = useUndo(chips, rows);
  const groups = state.groups ?? [];
  if (!scope || (!groups.length && !canSave)) return null;
  const { edit, say } = scope;
  // Another playback's outcome isn't this one's to undo (Core would refuse it): it shows again on its own tab.
  const outcome =
    scope.outcome?.playbackId && scope.outcome.playbackId !== state.player.playbackId
      ? null
      : scope.outcome;
  const open = groups.find((group) => group.id === opened);
  return (
    <div className="grid">
      <GroupLine
        lineRef={chips}
        connected={connected}
        outcome={outcome}
        undoing={undoing}
        onUndo={undo}
        onSave={canSave ? () => edit({ name: "", members: membersOf(rows) }) : undefined}
        chips={groups.map((group) => ({
          group,
          ...groupStatus(planGroup(group, rows, state)),
          open: group.id === opened,
          onClick: () => {
            say(null);
            setOpened(group.id === opened ? null : group.id);
          },
        }))}
      />
      {open && (
        <GroupPreview
          key={open.id}
          group={open}
          plan={planGroup(open, rows, state)}
          rows={rows}
          title={title}
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

/**
 * Choose where it plays' Groups line: a chip fills the choice with what the group asks that each device can play now,
 * and says what it left out; nothing plays until Play. Save as group saves the choice as it stands.
 */
export function ChoiceGroups({
  state,
  connected,
  rows,
  choice,
  onChoose,
}: {
  state: ClientSessionState;
  connected: boolean;
  rows: ChoiceRow[];
  choice: Choice;
  onChoose: (choice: Choice, left: string[]) => void;
}) {
  const scope = useContext(Groups);
  const canSave = useCanSave();
  const chips = useRef<HTMLDivElement>(null);
  const { undoing, undo } = useUndo(chips, []);
  const groups = state.groups ?? [];
  if (!scope || (!groups.length && !canSave)) return null;
  const same = (one: Choice, two: Choice) =>
    Object.keys(one).length === Object.keys(two).length &&
    Object.entries(one).every(
      ([id, chosen]) => two[id]?.picture === chosen.picture && two[id]?.sound === chosen.sound,
    );
  return (
    <GroupLine
      lineRef={chips}
      connected={connected}
      outcome={scope.outcome}
      undoing={undoing}
      onUndo={undo}
      onSave={
        canSave
          ? () =>
              scope.edit({
                name: "",
                members: Object.entries(choice).map(([deviceId, chosen]) => ({
                  deviceId,
                  ...chosen,
                })),
              })
          : undefined
      }
      chips={groups.map((group) => {
        const filled = groupChoice(group, rows);
        return {
          group,
          on: Object.keys(filled.choice).length > 0 && same(filled.choice, choice),
          onClick: () => {
            scope.say(null);
            onChoose(filled.choice, filled.left);
          },
        };
      })}
    />
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
  title,
  playbackId,
  connected,
  onEdit,
  onApplied,
}: {
  group: MixerGroup;
  plan: Plan;
  rows: Row[];
  title?: string | null;
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
        // Its output change counts once Core takes it, even if the unmute that follows fails.
        for (const [index, action] of step.actions.entries()) {
          await gate.command(action);
          if (!index) applied.push(...step.undone);
        }
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
    const moved = applied.some((change) => change.from);
    onApplied({
      group: group.id,
      playbackId,
      text: `${group.name} applied${except.length ? `, except ${listed(except)}` : ""}.${moved ? " Undo changes only this playback." : ""}`,
      // Built from the rows as they are when Undo is pressed, after Apply changed them.
      undo: async (now) => {
        for (const step of undoSteps(applied, now, playbackId))
          for (const action of step.actions) await gate.command(action);
      },
    });
  };
  return (
    <section
      aria-label={group.name}
      className="mb-3 grid gap-2 rounded-lg bg-secondary px-3.5 pt-2.5 pb-3.5"
    >
      <div data-nav-row className="flex min-h-10 items-center gap-2">
        <h3 className="min-w-0 flex-1 font-heading text-body font-semibold [overflow-wrap:anywhere]">
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
          className="max-w-full"
        >
          <span className="truncate">{title ? `Apply to ${title}` : "Apply"}</span>
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {outcome}
        </span>
      </div>
    </section>
  );
}
