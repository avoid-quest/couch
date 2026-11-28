import { createContext, useContext, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { RowOptions, type MenuAction } from "@/components/RowMenu";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { isTvPresentation } from "@/session/presentation";
import { controlBox, undoable } from "@/toasts";
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
function focusAfter(section: Element | null | undefined) {
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

/** Takes the section holding the focus off Home, with Undo beside its "…". */
export function leaveHome(text: string, go: () => void, undo: () => void) {
  const box = controlBox();
  focusAfter(document.activeElement?.closest("section"));
  go();
  undoable(text, undo, undefined, box);
}

/** What every Home section's "…" holds: Move up, Move down and Hide, each with Undo. */
function useSectionActions(id: HomeSectionId, name: string): MenuAction[] {
  const order = useContext(HomeOrder);
  const at = order.indexOf(id);
  // Undo appears beside the "…" in the section's new place.
  const move = (by: -1 | 1) => {
    const undo = moveHomeSection(id, by, (other) => order.includes(other));
    if (!undo) return;
    keepFocus(id, (options) =>
      undoable(
        `${name} moved ${by < 0 ? "up" : "down"}.`,
        () => {
          undo();
          keepFocus(id);
        },
        undefined,
        controlBox(options),
      ),
    );
  };
  return [
    { label: "Move up", disabled: at <= 0, run: () => move(-1) },
    { label: "Move down", disabled: at < 0 || at === order.length - 1, run: () => move(1) },
    {
      label: "Hide",
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
 * A Home section's "…", at the end of its heading's line; a followed section's adds Rename and Remove. Its menu hangs
 * from it on desktops and the TV; a phone's Sheet rises from the bottom.
 */
export function SectionOptions({
  id,
  name,
  rename,
  remove,
}: {
  id: HomeSectionId;
  name: string;
  rename?: MenuAction;
  remove?: MenuAction;
}) {
  const router = useRouter();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const actions = [
    ...(rename ? [rename] : []),
    ...useSectionActions(id, name),
    ...(remove ? [remove] : []),
    {
      label: "Edit Home",
      run: () => void router.navigate({ to: settingsPagePath("home") }),
    },
  ];
  return (
    <span data-section-options={id} className="ml-auto flex shrink-0">
      {desktop || isTvPresentation() ? (
        <RowOptions title={name} actions={actions} />
      ) : (
        <OptionsSheet title={name} actions={actions} />
      )}
    </span>
  );
}

/** A phone's section menu. A verb runs once the Sheet has given the focus back to the "…", as the menu's do. */
function OptionsSheet({ title, actions }: { title: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const chosen = useRef<() => void>(undefined);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          ref={trigger}
          data-row-options
          variant="ghost"
          size="icon"
          aria-label={`Options for ${title}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="max-h-[85dvh] overflow-y-auto px-(--gutter) py-4"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
          const run = chosen.current;
          chosen.current = undefined;
          run?.();
        }}
      >
        <div className="mx-auto grid w-full max-w-3xl gap-1">
          <SheetTitle className="mb-2 pr-11">{title}</SheetTitle>
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              disabled={action.disabled}
              className="h-auto justify-start rounded-md px-2 py-3 text-left"
              onClick={() => {
                chosen.current = action.run;
                setOpen(false);
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
