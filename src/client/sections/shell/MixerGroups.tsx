import { createContext, useContext, useRef, useState, type ReactNode, type Ref } from "react";
import { Check, Lock, Minus, Plus, WifiOff } from "lucide-react";
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
  planChoice,
  planGroup,
  type Change,
  type Plan,
} from "@/session/groups";
import type { MixerGroup } from "../../../shared/mixer-groups";
import { GroupEditor, said, type GroupDraft } from "./GroupEditor";

const Groups = createContext<{ edit: (draft: GroupDraft) => void } | null>(null);

/** Editing a group: the host and administrators save one, which takes the list's place until it saves or cancels. */
export const useGroupEdit = () => useContext(Groups)?.edit;

/** The open desk's groups: saving one takes the list's place until it saves or cancels. */
export function GroupsScope({
  state,
  connected,
  children,
}: {
  state: ClientSessionState;
  connected: boolean;
  children: ReactNode;
}) {
  const gate = useContext(SessionGateContext);
  const [editing, setEditing] = useState<GroupDraft | null>(null);
  return (
    <Groups value={{ edit: setEditing }}>
      {editing ? (
        <GroupEditor
          state={state}
          connected={connected}
          draft={editing}
          onDone={(outcome) => {
            setEditing(null);
            if (outcome) gate?.offerUndo(outcome.text, outcome.undo);
          }}
        />
      ) : (
        children
      )}
    </Groups>
  );
}

/** Who may save groups: the host and admins, as Core checks (settings-scope.ts reads it the same way). */
export function useCanSave() {
  const gate = useContext(SessionGateContext);
  const host = gate?.identity ? gate.identity.authority === "host" : !!gate?.localHost;
  return host || gate?.identity?.authority === "administrator";
}

/** The groups as chips: ✓ while one plays as saved, "3 of 4" while only part of it can, the open one inverted. */
function GroupLine({
  chips,
  lineRef,
}: {
  chips: {
    group: MixerGroup;
    on: boolean;
    part?: string;
    open?: boolean;
    onClick: () => void;
  }[];
  lineRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={lineRef}
      data-nav-row
      role="group"
      aria-label="Groups"
      className="flex flex-wrap gap-1.5 pt-0.5 pb-2.5"
    >
      {chips.map(({ group, on, part, open, onClick }) => (
        <Button
          key={group.id}
          data-group={group.id}
          variant="secondary"
          size="xs"
          aria-expanded={open}
          onClick={onClick}
          className="h-7.5 gap-1.5 px-3 text-meta font-semibold aria-expanded:bg-foreground aria-expanded:text-background aria-expanded:[&_.text-subtle-foreground]:text-background/60"
        >
          {on && <Check aria-hidden="true" />}
          {group.name}
          {part && <span className="font-normal text-subtle-foreground tabular-nums">{part}</span>}
        </Button>
      ))}
    </div>
  );
}

/**
 * The desk's groups. Opening a chip shows, in place, what applying it to this playback (`title`) would change, before
 * anything does; Apply says what it did with an Undo that puts every device back.
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
  const edit = useGroupEdit();
  const canSave = useCanSave();
  const [opened, setOpened] = useState<string | null>(null);
  const chips = useRef<HTMLDivElement>(null);
  const groups = state.groups ?? [];
  if (!groups.length) return null;
  const open = groups.find((group) => group.id === opened);
  return (
    <div className="grid">
      <GroupLine
        lineRef={chips}
        chips={groups.map((group) => ({
          group,
          ...groupStatus(planGroup(group, rows, state)),
          open: group.id === opened,
          onClick: () => setOpened(group.id === opened ? null : group.id),
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
          onEdit={canSave && edit ? () => edit(open) : undefined}
          onApplied={() => {
            // Focus goes back to its chip before the preview closes under it.
            chips.current?.querySelector<HTMLElement>(`[data-group="${open.id}"]`)?.focus();
            setOpened(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Choose where it plays' groups. Opening a chip shows what the group would change in the choice, as the desk's preview
 * does; Use this group fills the choice with what each device can play now and says what it left out. Nothing plays
 * until Play.
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
  const [opened, setOpened] = useState<string | null>(null);
  const chips = useRef<HTMLDivElement>(null);
  const groups = state.groups ?? [];
  if (!groups.length) return null;
  const open = groups.find((group) => group.id === opened);
  return (
    <div className="grid">
      <GroupLine
        lineRef={chips}
        chips={groups.map((group) => ({
          group,
          ...groupStatus(planChoice(group, rows, choice, state)),
          open: group.id === opened,
          onClick: () => setOpened(group.id === opened ? null : group.id),
        }))}
      />
      {open && (
        <GroupPreview
          key={open.id}
          group={open}
          plan={planChoice(open, rows, choice, state)}
          connected={connected}
          onUse={() => {
            const filled = groupChoice(open, rows);
            chips.current?.querySelector<HTMLElement>(`[data-group="${open.id}"]`)?.focus();
            setOpened(null);
            onChoose(filled.choice, filled.left);
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
      "flex items-baseline gap-2 [overflow-wrap:anywhere]",
      quiet ? "text-subtle-foreground" : "text-muted-foreground",
    )}
  >
    <span className="translate-y-0.5 text-subtle-foreground [&_svg]:size-3.5">{icon}</span>
    <span>{text}</span>
  </li>
);

/**
 * What applying a group to this playback would do, line by line, with Apply and Edit under it; for a choice not yet
 * played (`onUse`), what it would change in the choice, with Use this group.
 */
function GroupPreview({
  group,
  plan,
  rows = [],
  title,
  playbackId = null,
  connected,
  onEdit,
  onApplied,
  onUse,
}: {
  group: MixerGroup;
  plan: Plan;
  rows?: Row[];
  title?: string | null;
  playbackId?: string | null;
  connected: boolean;
  onEdit?: () => void;
  onApplied?: () => void;
  onUse?: () => void;
}) {
  const gate = useContext(SessionGateContext);
  const [busy, setBusy] = useState(false);
  const name = (text: string) => <span className="text-foreground">{text}</span>;
  const lines = [
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
    ...plan.same.map((item) =>
      line(
        `same:${item.deviceId}:${item.channel}`,
        <Check />,
        <>
          {name(item.name)} {item.channel}
        </>,
        true,
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
    ? ""
    : !plan.same.length
      ? "None of it can play here now."
      : onUse
        ? "Already set like this."
        : "It already plays like this.";
  const apply = async () => {
    if (!gate || !playbackId) return;
    setBusy(true);
    gate.setError(null);
    const applied: Change[] = [],
      refused: string[] = [];
    let reason: unknown;
    const steps = async () => {
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
      return applied.length > 0;
    };
    const except = () => [
      ...plan.left.map(
        (item) => `${channelNames([item])[0]} (${item.reason}${item.stays ? ", still on" : ""})`,
      ),
      ...refused,
    ];
    const done = await gate.takeWithUndo(
      steps,
      () => `${group.name} applied${except().length ? `, except ${listed(except())}` : ""}.`,
    );
    setBusy(false);
    if (!done) {
      gate.setError(said(reason));
      return;
    }
    onApplied?.();
  };
  return (
    <section
      aria-label={group.name}
      className="mb-3 -mt-1 grid gap-2.5 rounded-[0.7rem] bg-(--fill) px-3.5 py-3 text-meta"
    >
      <ul className="grid gap-1">{lines}</ul>
      {outcome && (
        <p role="status" className="text-subtle-foreground">
          {outcome}
        </p>
      )}
      <div data-nav-row className="flex flex-wrap items-center gap-2">
        {onUse ? (
          <Button size="sm" disabled={!connected || !count} onClick={onUse}>
            Use this group
          </Button>
        ) : (
          <Button
            size="sm"
            aria-label={title ? `Apply ${group.name} to ${title}` : undefined}
            disabled={!connected || !count || busy || !playbackId}
            onClick={() => void apply()}
          >
            Apply
          </Button>
        )}
        {onEdit && (
          <Button variant="ghost" size="sm" disabled={!connected} onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>
    </section>
  );
}
