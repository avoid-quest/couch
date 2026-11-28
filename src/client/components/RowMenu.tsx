import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { startHold } from "@/hold";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { isTvPresentation } from "@/session/presentation";
import { deviceId } from "@/session/device-id";
import type { PlayOn } from "../../shared/protocol";
import { ChooseDevice, PlayOnGroup, usePlayOn } from "./PlayOn";
import { PlaceRows } from "./PlayOnPlaces";

/**
 * One verb in a menu. playOn makes it "Play on…", which swaps the menu's rows for Play on's places (audioOnly: it has
 * no picture; thumbnail: the item's picture in Choose where it plays; verb: its Play's word, "Resume" for an item
 * partly played);
 * a shared source's (sharingDeviceId, liveAudio) is instead a group of the online Devices. node is its own item, such as a link.
 * group sets it apart from the verbs of another group (docs/design.md "Menus"); now runs it in the press itself, for
 * what the browser allows only there (the clipboard, the share sheet).
 */
export type MenuAction = {
  label: string;
  group?: string;
  disabled?: boolean;
  pressed?: boolean;
  run?: () => void;
  now?: boolean;
  node?: ReactNode;
  playOn?: (on: PlayOn) => void;
  audioOnly?: boolean;
  thumbnail?: string;
  verb?: string;
  sharingDeviceId?: string;
  liveAudio?: boolean;
};

/**
 * An item's groups, in the order its menu shows them, and the play verbs' order; a menu's own groups (a list's, a
 * setting's) follow in the order it gives them, as do the groups of other menus.
 */
const itemGroups = ["play", "keep", "go", "share", "list"];
const playVerbs = ["Play", "Resume", "Play all", "From start", "Play next", "Queue", "Queue all"];

/** The menu's rows by group, Play on… last among the play verbs, with a separator wherever the group changes. */
function arranged(actions: MenuAction[]) {
  const rank = (action: MenuAction) => {
    const group = itemGroups.indexOf(action.group ?? "");
    const verb = action.playOn
      ? playVerbs.length
      : playVerbs.indexOf(action.label.replace(/ \(.*\)$/, ""));
    return (group < 0 ? itemGroups.length : group) * 100 + (action.group === "play" ? verb + 1 : 0);
  };
  return actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => rank(a.action) - rank(b.action) || a.index - b.index)
    .map(({ action }, index, all) => ({
      action,
      separated: index > 0 && all[index - 1]!.action.group !== action.group,
    }));
}

const sheetRow =
  "h-auto min-h-11 w-full justify-start rounded-md px-2 py-2.5 text-left font-normal whitespace-normal";

// A shared source's Play on devices are a labelled group, set apart from the verbs on either side.
function Items({
  actions,
  on,
  select,
  choose,
  sheet,
  listed,
}: {
  actions: MenuAction[];
  on: (label: string) => string;
  select: (action: MenuAction) => void;
  choose: (action: MenuAction) => void;
  sheet: boolean;
  listed: boolean;
}) {
  const Separator = sheet ? SheetSeparator : DropdownMenuSeparator;
  return arranged(actions).map(({ action, separated }, index, all) => {
    const shared = listed && sharedPlayOn(action);
    const label = action.playOn
      ? `${action.label}…`
      : action.label === "Play" || action.label === "Resume"
        ? on(action.label)
        : action.label;
    return (
      <Fragment key={action.label}>
        {separated && !shared && <Separator />}
        {shared ? (
          <>
            <PlayOnGroup
              separated={index > 0}
              sheet={sheet}
              disabled={action.disabled}
              onPlay={(deviceId) => select({ ...action, run: () => action.playOn?.({ deviceId }) })}
              sharingDeviceId={action.sharingDeviceId}
              liveAudio={action.liveAudio}
            />
            {index < all.length - 1 && <Separator />}
          </>
        ) : sheet ? (
          <Button
            variant="ghost"
            asChild={!!action.node}
            disabled={action.disabled}
            className={sheetRow}
            onClick={() => (action.playOn ? choose(action) : select(action))}
          >
            {action.node ?? label}
            {action.playOn && <ChevronRight aria-hidden="true" className="ml-auto" />}
          </Button>
        ) : action.node ? (
          <DropdownMenuItem asChild>{action.node}</DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={action.disabled}
            onSelect={(event) => {
              if (!action.playOn) return select(action);
              // Play on… keeps the menu open, its rows swapped for the places; a shared source's opens its devices
              // once the menu has closed.
              if (!sharedPlayOn(action)) event.preventDefault();
              choose(action);
            }}
          >
            {label}
            {action.playOn && <ChevronRight aria-hidden="true" className="ml-auto" />}
          </DropdownMenuItem>
        )}
      </Fragment>
    );
  });
}

const SheetSeparator = () => <Separator className="my-1" />;

const sharedPlayOn = (action: MenuAction) =>
  !!action.playOn && !!(action.sharingDeviceId || action.liveAudio);

// Past nine rows a menu is hard to read and to walk with a remote: these go first, in turn, then the rows past the
// ninth (docs/design.md "Menus").
const menuRows = 9;
const trims: ((action: MenuAction, rows: MenuAction[]) => boolean)[] = [
  (action) => action.label === "Open in browser",
  (action, rows) =>
    rows.filter((row) => row.group === "go" && row.label.startsWith("Go to "))[1] === action,
  (action, rows) => action.label === "Queue" && rows.some((row) => row.label === "Play next"),
];
function trimmed(actions: MenuAction[]) {
  let rows = actions;
  for (const trim of trims)
    if (rows.length > menuRows) rows = rows.filter((action) => !trim(action, rows));
  if (rows.length <= menuRows) return rows;
  const kept = new Set(
    arranged(rows)
      .slice(0, menuRows)
      .map(({ action }) => action),
  );
  return rows.filter((action) => kept.has(action));
}

const own = (event: { currentTarget: Element; target: EventTarget }) =>
  event.target instanceof Node && event.currentTarget.contains(event.target);
type ItemProps = Pick<
  HTMLAttributes<HTMLElement>,
  | "className"
  | "onContextMenu"
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onTouchEnd"
  | "onClickCapture"
>;

/**
 * An item's one menu, for a row or a tile. Spread `item` on the item and `target` on its primary target (its press);
 * `ItemMenu` draws the "…" and the menu. Every way in opens it the same way: the "…"; right-click, the keyboard's
 * menu key and Shift+F10, which reach the item as `contextmenu`; a long press on touch; and a held OK on a remote,
 * which navigation.ts turns into `contextmenu` on a target marked `data-item-menu`.
 */
export function useItemMenu(actions: MenuAction[]) {
  const { devices, on, queueAllowed } = usePlayOn();
  const fits = (action: MenuAction) => (device: (typeof devices)[number]) =>
    !action.liveAudio ||
    (device.id !== action.sharingDeviceId && (device.id === deviceId() || device.sharing?.audio));
  // Play on waits for a second online Device, so it alone never makes a menu.
  const shown = trimmed(
    actions.filter(
      (action) =>
        (queueAllowed !== false || !["Queue", "Queue all", "Play next"].includes(action.label)) &&
        (!action.playOn || devices.some(fits(action))),
    ),
  );
  // A shared source's devices are the menu's rows while they fit in nine; past that "Play on…" opens them by themselves.
  const shared = shown.find(sharedPlayOn);
  const listed = !shared || shown.length - 1 + devices.filter(fits(shared)).length <= menuRows;
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const press = useRef<{ release: () => boolean; x: number; y: number } | null>(null);
  const held = useRef(false);
  // macOS opens a context menu as the right button goes down: its release, over a row, is not a choice.
  const pressing = useRef(false);
  if (!shown.length)
    return {
      shown,
      listed,
      on,
      open: false,
      setOpen,
      opener,
      pressing,
      item: {} as ItemProps,
      target: {} as { onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void },
    };
  // Focus comes back to what opened it: the control pressed, else the item's primary target.
  const openFrom = (item: HTMLElement, target: EventTarget) => {
    const control =
      target instanceof Element ? target.closest<HTMLElement>("button, a[href]") : null;
    opener.current =
      control && item.contains(control)
        ? control
        : item.querySelector<HTMLElement>("[data-item-menu]");
    setOpen(true);
  };
  const cancel = () => {
    press.current?.release();
    press.current = null;
  };
  const item: ItemProps = {
    // No text selection or iOS link preview on a long press.
    className: "group/menu select-none [-webkit-touch-callout:none]",
    // A portal's events reach the item through React, so only the item's own open its menu.
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      if (event.buttons & 2) {
        pressing.current = true;
        window.addEventListener("pointerup", () => (pressing.current = false), { once: true });
      }
      if (press.current) held.current = true;
      cancel();
      if (own(event)) openFrom(event.currentTarget, event.target);
    },
    // iOS fires no contextmenu, so a touch held still opens the menu (Android fires one too, above).
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      held.current = false;
      if (event.pointerType !== "touch" || !own(event)) return;
      const { currentTarget: item, target } = event;
      press.current = {
        ...startHold(() => {
          held.current = true;
          openFrom(item, target);
        }),
        x: event.clientX,
        y: event.clientY,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (
        press.current &&
        Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10
      )
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // A long press ends without the mouse events, focus and click a tap makes, which would close the menu or press the item.
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      if (held.current) event.preventDefault();
    },
    // Not every browser drops that click for a prevented touchend, so a click a held press still makes stops here once.
    // A keyboard's click (detail 0) never does: Enter after a long press must still press the item.
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (held.current && event.detail) {
        event.preventDefault();
        event.stopPropagation();
        held.current = false;
      }
    },
  };
  return {
    shown,
    listed,
    on,
    open,
    setOpen,
    opener,
    pressing,
    item,
    target: {
      "data-item-menu": "",
      // macOS browsers send no contextmenu for Shift+F10, so the primary target opens its menu itself.
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "F10" || !event.shiftKey) return;
        event.preventDefault();
        opener.current = event.currentTarget;
        setOpen(true);
      },
    },
  };
}

/** Secondary verbs beside a settings row's main control. */
export function RowOptions({
  title,
  actions,
  disabled,
}: {
  title: string;
  actions: MenuAction[];
  disabled?: boolean;
}) {
  return <ItemMenu menu={useItemMenu(actions)} title={title} disabled={disabled} runAfterClose />;
}

/**
 * The item's "…" ("Options for {title}") and its one menu. On desktops and the TV a controlled DropdownMenu hangs from
 * the "…", or from the whole item where the "…" is hidden (a row whose page holds its verbs), so it opens in one place
 * whatever opened it; on phones a menu of more than two rows is a Sheet rising from the bottom. The "…" shows on touch
 * screens, and elsewhere while the item is hovered or holds focus.
 */
export function ItemMenu({
  menu,
  title,
  hidden = false,
  runAfterClose = false,
  className,
  ...props
}: {
  menu: ReturnType<typeof useItemMenu>;
  title: string;
  hidden?: boolean;
  runAfterClose?: boolean;
} & ComponentProps<typeof Button>) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const sheet = !desktop && !isTvPresentation() && menu.shown.length > 2;
  const trigger = useRef<HTMLButtonElement>(null);
  const outside = useRef(false);
  const acted = useRef(false);
  const deferred = useRef<(() => void) | undefined>(undefined);
  // Choose where it plays takes the focus as Play on's places hand off to it.
  const handedOff = useRef(false);
  // A shared source's Play on… opens its devices once the menu has closed, from what opened the menu; any other's
  // swaps the menu's rows for Play on's places, with Back.
  const [choosing, setChoosing] = useState<MenuAction | null>(null);
  const [places, setPlaces] = useState<MenuAction | null>(null);
  const from = useRef<HTMLElement | null>(null);
  const choose = (action: MenuAction) => {
    if (!sharedPlayOn(action)) return setPlaces(action);
    acted.current = true;
    deferred.current = () => {
      from.current = menu.opener.current ?? trigger.current;
      setChoosing(action);
    };
    if (sheet) menu.setOpen(false);
  };
  // A verb runs from the item, not the closing menu, so what it records (Details' opener, Up next's removal) is the item.
  // A Sheet's verbs run once it has given the focus back, as a settings row's do.
  const select = (action: MenuAction) => {
    acted.current = true;
    if (action.now) action.run?.();
    else if (runAfterClose || sheet) deferred.current = action.run;
    else {
      (menu.opener.current ?? trigger.current)?.focus();
      action.run?.();
    }
    if (sheet) menu.setOpen(false);
  };
  // A verb that takes its own item away (Remove, Saved) leaves focus with the item's neighbour in its list or shelf, on
  // the same control where it has one; a list with its own rule (Up next, Library) has moved it already.
  useLayoutEffect(
    () => () => {
      const from = menu.opener.current ?? trigger.current,
        item = from?.closest("li"),
        list = item?.parentElement;
      if (!acted.current || !item || !list || !item.contains(document.activeElement)) return;
      const index = [...list.children].indexOf(item),
        same = from!.matches("[data-row-options]") ? "[data-row-options]" : "[data-item-menu]";
      requestAnimationFrame(() => {
        if (!list.isConnected || document.activeElement !== document.body) return;
        const next = list.children[Math.min(index, list.children.length - 1)],
          stop = ":is(button, a[href]):not(:disabled):not([tabindex='-1'])";
        (
          next?.querySelector<HTMLElement>(same + stop) ?? next?.querySelector<HTMLElement>(stop)
        )?.focus();
      });
    },
    [],
  );
  if (!menu.shown.length) return null;
  const closed = (event: Event) => {
    event.preventDefault();
    // Back to the item or its "…", unless a press went elsewhere or Remove took the row away (its list moves focus on).
    const to = menu.opener.current ?? trigger.current;
    if (!outside.current && !handedOff.current && to?.isConnected) to.focus();
    outside.current = false;
    handedOff.current = false;
    // A settings confirmation opens after the menu releases its focus scope, so Cancel returns to the row.
    const run = deferred.current;
    deferred.current = undefined;
    run?.();
  };
  const button = hidden ? (
    <span
      aria-hidden="true"
      aria-label={`Options for ${title}`}
      className="pointer-events-none absolute inset-0"
    />
  ) : (
    <Button
      ref={trigger}
      data-row-options
      variant="ghost"
      size="icon"
      aria-label={`Options for ${title}`}
      className={className}
      {...props}
    >
      <MoreHorizontal aria-hidden="true" />
    </Button>
  );
  const placeItem = places?.playOn && {
    title,
    thumbnail: places.thumbnail,
    verb: places.verb,
    audioOnly: places.audioOnly,
    onPlay: places.playOn,
  };
  const back = (event?: Event) => {
    event?.preventDefault();
    setPlaces(null);
  };
  const items = placeItem ? (
    <PlaceRows
      item={placeItem}
      from={() => menu.opener.current ?? trigger.current}
      onDone={(handOff) => {
        acted.current = true;
        handedOff.current = !!handOff;
        if (sheet) menu.setOpen(false);
      }}
      heading={(text) =>
        sheet ? (
          <Button key="back" variant="ghost" className={sheetRow} onClick={() => back()}>
            <ChevronLeft aria-hidden="true" />
            {text}
          </Button>
        ) : (
          <DropdownMenuItem key="back" onSelect={back} className="text-subtle-foreground">
            <ChevronLeft aria-hidden="true" />
            {text}
          </DropdownMenuItem>
        )
      }
      separator={(key) =>
        sheet ? <SheetSeparator key={key} /> : <DropdownMenuSeparator key={key} />
      }
      row={(key, onSelect, children) =>
        sheet ? (
          <Button key={key} variant="ghost" className={sheetRow} onClick={onSelect}>
            {children}
          </Button>
        ) : (
          <DropdownMenuItem key={key} onSelect={onSelect}>
            {children}
          </DropdownMenuItem>
        )
      }
    />
  ) : (
    <Items
      actions={menu.shown}
      on={menu.on}
      select={select}
      choose={choose}
      sheet={sheet}
      listed={menu.listed}
    />
  );
  // Not part of the menu: a shared source's devices open from what opened the menu once it has closed.
  const panel = choosing?.playOn && (
    <ChooseDevice
      title={title}
      sharingDeviceId={choosing.sharingDeviceId}
      liveAudio={choosing.liveAudio}
      onPlay={(deviceId) => choosing.playOn?.({ deviceId })}
      onClose={() => setChoosing(null)}
      anchor={from}
    />
  );
  const change = (open: boolean) => {
    if (open) menu.opener.current = null;
    setPlaces(null);
    menu.setOpen(open);
  };
  if (sheet)
    return (
      <Sheet open={menu.open} onOpenChange={change}>
        <SheetTrigger asChild>{button}</SheetTrigger>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="max-h-[85dvh] overflow-y-auto px-(--gutter) py-4"
          onCloseAutoFocus={closed}
        >
          <div className="mx-auto grid w-full max-w-3xl">
            <SheetTitle className="mb-2 pr-11 break-words">{title}</SheetTitle>
            {items}
          </div>
        </SheetContent>
        {panel}
      </Sheet>
    );
  return (
    <DropdownMenu modal={false} open={menu.open} onOpenChange={change}>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      {/* Radix lands a keyboard or a remote (whose keys it hears) on the first verb, and leaves a pointer on the menu itself. */}
      <DropdownMenuContent
        align="end"
        className={placeItem ? "w-[19rem]" : undefined}
        data-tv-local-only={
          trigger.current?.closest("[data-tv-local-only], .tv-local-only") ? "" : undefined
        }
        onInteractOutside={() => {
          outside.current = true;
        }}
        onCloseAutoFocus={closed}
        onPointerUpCapture={(event) => {
          if (!menu.pressing.current) return;
          menu.pressing.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {items}
      </DropdownMenuContent>
      {panel}
    </DropdownMenu>
  );
}
