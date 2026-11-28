import { createContext, useContext } from "react";
import { useRouter } from "@tanstack/react-router";
import { RowOptions, type MenuAction } from "@/components/RowMenu";
import { undoable } from "@/toasts";
import { settingsPagePath } from "../../../shared/settings-pages";
import { moveHomeSection, setHomeSectionShown, type HomeSectionId } from "./home-rows";

/** The sections Home shows, in its order: where a section's moves go, and which reach an end. */
export const HomeOrder = createContext<readonly HomeSectionId[]>([]);

const control = ":is(button, a[href]):not(:disabled):not([tabindex='-1'])";

// Home draws a change on a later frame, a few on the TV: wait for it, a third of a second at most.
function whenDrawn(done: () => boolean, frames = 20) {
  requestAnimationFrame(() => {
    if (!done() && frames) whenDrawn(done, frames - 1);
  });
}

/**
 * Where the focus goes when a section leaves Home (Hide, Remove): the next section's first control, else the
 * previous one's, so a remote stays on Home. Taken before the section goes; given once it has.
 */
export function focusAfter(section: Element | null | undefined) {
  const page = section?.closest("[data-page]");
  if (!section || !page) return;
  const sections = [...page.querySelectorAll<HTMLElement>("section")].filter(
    (other) => other.parentElement?.closest("section, [data-page]") === page,
  );
  const at = sections.findIndex((other) => other.contains(section));
  const next = [...sections.slice(at + 1), ...sections.slice(0, at).reverse()]
    .map((other) => other.querySelector<HTMLElement>(control))
    .find(Boolean);
  whenDrawn(() => {
    if (!next?.isConnected) return true;
    if (section.isConnected) return false;
    next.focus();
    return true;
  });
}

/**
 * A moved section's "…" keeps the focus: Home draws the section in its new place, which can drop it. `then` runs
 * once it stands there, with the "…" where it now is.
 */
function keepFocus(id: HomeSectionId, then?: (options: HTMLElement) => void) {
  const before = document.querySelector(`[data-section-options="${CSS.escape(id)}"]`);
  const top = before?.getBoundingClientRect().top;
  whenDrawn(() => {
    const options = document.querySelector<HTMLElement>(
      `[data-section-options="${CSS.escape(id)}"] [data-row-options]`,
    );
    if (!options || options.getBoundingClientRect().top === top) return false;
    if (document.activeElement === document.body || document.activeElement === options)
      options.focus();
    then?.(options);
    return true;
  });
}

/** Takes the section holding the focus off Home, with Undo. */
export function leaveHome(text: string, go: () => void, undo: () => void) {
  focusAfter(document.activeElement?.closest("section"));
  go();
  undoable(text, undo);
}

/** What every Home section's "…" holds: Move up, Move down and Hide, each with Undo. */
function useSectionActions(id: HomeSectionId, name: string): MenuAction[] {
  const order = useContext(HomeOrder);
  const at = order.indexOf(id);
  const move = (by: -1 | 1) => {
    const undo = moveHomeSection(id, by, (other) => order.includes(other));
    if (!undo) return;
    keepFocus(id, () =>
      undoable(`${name} moved ${by < 0 ? "up" : "down"}.`, () => {
        undo();
        keepFocus(id);
      }),
    );
  };
  return [
    { label: "Move up", group: "arrange", disabled: at <= 0, run: () => move(-1) },
    {
      label: "Move down",
      group: "arrange",
      disabled: at < 0 || at === order.length - 1,
      run: () => move(1),
    },
    {
      label: "Hide",
      group: "take away",
      run: () =>
        leaveHome(
          `${name} hidden on this device.`,
          () => setHomeSectionShown(id, false),
          () => setHomeSectionShown(id, true),
        ),
    },
  ];
}

/**
 * A Home section's "…", at the end of its heading's line; a followed section's adds Rename… and Remove from Home. Its
 * groups are the list's own (`list`: Up next's Save as list…), how it stands (Rename…, Move up, Move down), taking it
 * away (Hide, Remove from Home) and Edit Home. Its
 * menu hangs from it on desktops and the TV; a phone's Sheet rises from the bottom.
 */
export function SectionOptions({
  id,
  name,
  rename,
  remove,
  list = [],
}: {
  id: HomeSectionId;
  name: string;
  rename?: MenuAction;
  remove?: MenuAction;
  list?: MenuAction[];
}) {
  const router = useRouter();
  const actions = [
    ...list,
    ...(rename ? [{ ...rename, group: "arrange" }] : []),
    ...useSectionActions(id, name),
    ...(remove ? [{ ...remove, group: "take away" }] : []),
    {
      label: "Edit Home",
      group: "home",
      run: () => void router.navigate({ to: settingsPagePath("home") }),
    },
  ];
  return (
    <span data-section-options={id} className="ml-auto flex shrink-0">
      <RowOptions title={name} actions={actions} />
    </span>
  );
}
