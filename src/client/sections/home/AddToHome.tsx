import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, House, HousePlus, Search } from "lucide-react";
import { forLaterQuery } from "@/api/for-later";
import { historyQuery } from "@/api/progress";
import { providerPageQuery } from "@/api/providers";
import { MediaArtwork } from "@/components/MediaArtwork";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { collectionLinks } from "@/collection-target";
import { TRY_AGAIN } from "@/copy";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { useShell } from "@/sections/shell/shell-context";
import { isTvPresentation } from "@/session/presentation";
import { useSessionGate } from "@/session/session-context";
import { controlBox, undoable } from "@/toasts";
import type { QueueEntry } from "../../../shared/protocol";
import {
  providerForUrl,
  providerNames,
  type ProviderId,
  type ProviderPage,
} from "../../../shared/providers";
import { followId, useHomeFollows, type HomeFollow } from "./home-follows";
import { addHomeFollow, setHomeSectionShown, useHomeRows } from "./home-rows";

/** A series, show or channel that Home can follow: its page, whose lists are offered. */
export type AddTarget = { provider: ProviderId; url: string; title: string };
const opened = "couch.add-to-home";

/** Opens Add to Home for `target` from the control `from` (by default the one holding focus), from any menu or page. */
export const addToHome = (target: AddTarget, from?: HTMLElement) =>
  window.dispatchEvent(
    new CustomEvent<AddTarget & { from?: HTMLElement }>(opened, { detail: { ...target, from } }),
  );

/** The control a panel opens from: the one given, else the one holding focus, where a closed menu returns it. */
export const panelAnchor = (from?: HTMLElement) =>
  from ??
  (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null);

/**
 * Add and Rename's panel. On desktops and the TV it hangs from the control that opened it and grows from it; on
 * phones a Sheet rises from the bottom. Closing gives the focus back to that control.
 */
export function FollowPanel({
  open,
  anchor,
  title,
  onClose,
  onClosed,
  children,
}: {
  open: boolean;
  /** The control it opens from; without one (a page without focus) it rises from the bottom as on phones. */
  anchor: HTMLElement | null;
  title: string;
  onClose: () => void;
  /** Runs once it has closed and given the focus back, for a control that takes it elsewhere (Search). */
  onClosed?: () => void;
  children: ReactNode;
}) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  // Kept once it closes, so the panel leaves from where it opened and the focus has somewhere to go back to.
  const from = useRef(anchor);
  if (open) from.current = anchor;
  const change = (next: boolean) => !next && onClose();
  const back = (event: Event) => {
    event.preventDefault();
    if (from.current?.isConnected) from.current.focus();
    onClosed?.();
  };
  if ((desktop || isTvPresentation()) && from.current) {
    const box = from.current.getBoundingClientRect();
    return (
      <Popover open={open} onOpenChange={change}>
        <PopoverAnchor virtualRef={from as { current: HTMLElement }} />
        <PopoverContent
          aria-label={title}
          align={box.left + box.width / 2 < window.innerWidth / 2 ? "start" : "end"}
          collisionPadding={16}
          onCloseAutoFocus={back}
          className="max-h-[calc(var(--radix-popover-content-available-height)/var(--interface-scale))] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-4"
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        onCloseAutoFocus={back}
        className="max-h-[85dvh] overflow-y-auto px-(--gutter) pt-6 pb-8"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Takes the person to a followed section on Home, showing it again first when it is hidden there. Home may still be
 * opening: the section takes itself into view once it is there (FollowShelf).
 */
function goToFollow(id: HomeFollow["id"], changeSection: (section: "Home") => void) {
  setHomeSectionShown(id, true);
  wanted = id;
  changeSection("Home");
  requestAnimationFrame(() => revealFollow(id));
}
let wanted: HomeFollow["id"] | undefined;
/** Takes a followed section into view and onto its heading, once, when Home was asked to go to it. */
export function revealFollow(id: HomeFollow["id"]) {
  const section = document.querySelector<HTMLElement>(`[data-follow-section="${CSS.escape(id)}"]`);
  if (wanted !== id || !section) return;
  wanted = undefined;
  section.scrollIntoView({ block: "center", behavior: "smooth" });
  section
    .querySelector<HTMLElement>("a[href], button:not(:disabled)")
    ?.focus({ preventScroll: true });
}

/**
 * The lists a page publishes that a section can follow: the page itself where it lists items (episodes, videos,
 * a channel's broadcasts), and each list it holds (a programme's sets, a series' seasons, a channel's tabs).
 */
function followable(target: AddTarget, page: ProviderPage) {
  const media = page.items.filter((item) => item.kind === "media").length;
  const lists = page.items.filter((item) => item.kind === "collection");
  // A series' seasons come oldest first; its newest season leads, as what is new is there.
  if (lists.length && lists.every((item) => /\b(?:season|stagione)\b/i.test(item.title)))
    lists.reverse();
  return [
    ...(media * 2 >= page.items.length || !lists.length
      ? [{ url: target.url, list: page.title || target.title }]
      : []),
    ...lists.map((item) => ({ url: item.url, list: item.title })),
  ];
}

/** Add to Home's one panel, which any Add to Home opens beside the control it came from. */
export function AddToHomePanel() {
  const [open, setOpen] = useState<{ target: AddTarget; anchor: HTMLElement | null } | null>(null);
  useEffect(() => {
    const show = (event: Event) => {
      const { from, ...target } = (event as CustomEvent<AddTarget & { from?: HTMLElement }>).detail;
      setOpen({ target, anchor: panelAnchor(from) });
    };
    window.addEventListener(opened, show);
    return () => window.removeEventListener(opened, show);
  }, []);
  return (
    <FollowPanel
      open={!!open}
      anchor={open?.anchor ?? null}
      title={open ? `Add ${open.target.title} to Home` : "Add to Home"}
      onClose={() => setOpen(null)}
    >
      {open && (
        <AddToHomeForm
          key={open.target.url}
          target={open.target}
          anchor={open.anchor}
          done={() => setOpen(null)}
        />
      )}
    </FollowPanel>
  );
}

/**
 * Home's and Edit Home's Add a section: the series, programmes and channels of what you've played and saved, each
 * once, latest first. Choosing one is Add to Home for it, in the same panel; Search finds anything else.
 */
export function AddSectionPanel({
  anchor,
  onClose,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const { focusSearch } = useShell();
  const [chosen, setChosen] = useState<AddTarget | null>(null);
  const after = useRef<() => void>(undefined);
  const close = () => {
    setChosen(null);
    onClose();
  };
  return (
    <FollowPanel
      open={!!anchor}
      anchor={anchor}
      title={chosen ? `Add ${chosen.title} to Home` : "Add a section"}
      onClose={close}
      onClosed={() => {
        after.current?.();
        after.current = undefined;
      }}
    >
      {anchor &&
        (chosen ? (
          <AddToHomeForm key={chosen.url} target={chosen} anchor={anchor} done={close} />
        ) : (
          <SectionPicks
            choose={(target) => {
              setChosen(target);
              // The pick leaves with the list: the focus goes on to Add to Home's first control.
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLElement>(
                    "#add-to-home-name, [data-slot='popover-content'] button:not(:disabled)",
                  )
                  ?.focus(),
              );
            }}
            search={() => {
              after.current = focusSearch;
              close();
            }}
            done={close}
          />
        ))}
    </FollowPanel>
  );
}

/** What a played or saved item belongs to that Home can follow: its series or programme, else its channel. */
function itemTarget(item: Pick<QueueEntry, "collection" | "creator">): AddTarget | undefined {
  const [outer] = collectionLinks(item.collection);
  if (outer) return { provider: outer.provider, url: outer.url, title: outer.title };
  const provider = item.creator && providerForUrl(item.creator.url);
  if (provider) return { provider, url: item.creator!.url, title: item.creator!.title };
}

function SectionPicks({
  choose,
  search,
  done,
}: {
  choose: (target: AddTarget) => void;
  search: () => void;
  done: () => void;
}) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const follows = useHomeFollows();
  const history = useQuery({ ...historyQuery(credentials), enabled: connected });
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected });
  // Each once, with the lists of it you've played from, so one already on Home says so.
  const picks = new Map<string, { target: AddTarget; thumbnail?: string; lists: Set<string> }>();
  for (const item of [...(history.data?.items ?? []), ...(later.data?.items ?? [])]) {
    const target = itemTarget(item);
    if (!target) continue;
    const pick = picks.get(target.url) ?? { target, thumbnail: item.thumbnail, lists: new Set() };
    picks.set(target.url, pick);
    for (const link of [...collectionLinks(item.collection), item.creator])
      if (link) pick.lists.add(link.url);
  }
  return (
    <div className="grid gap-4">
      <PopoverHeader>
        <PopoverTitle className="font-heading text-base font-semibold">Add a section</PopoverTitle>
        <PopoverDescription>From what you've played and saved</PopoverDescription>
      </PopoverHeader>
      {connected && (history.isPending || later.isPending) ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Looking at what you've played…
        </p>
      ) : picks.size ? (
        <ul className="-mx-2 grid">
          {[...picks.values()].map(({ target, thumbnail, lists }) => (
            <li key={target.url}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-3 rounded-lg p-2 text-left font-normal whitespace-normal"
                onClick={() => choose(target)}
              >
                <span className="relative h-10 shrink-0 overflow-hidden rounded-md bg-muted">
                  <MediaArtwork
                    thumbnail={thumbnail}
                    title={target.title}
                    className="h-full w-auto"
                  />
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{target.title}</span>
                  <span className="truncate text-meta text-muted-foreground">
                    On {providerNames[target.provider]}
                  </span>
                </span>
                {follows.some((follow) => lists.has(follow.url)) ? (
                  <span className="text-meta text-muted-foreground">On Home</span>
                ) : (
                  <ChevronRight aria-hidden="true" className="text-muted-foreground" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing you've played or saved has a series, programme or channel to follow yet.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <p className="min-w-0 flex-1 basis-52 text-meta text-muted-foreground">
          Anything else: find it with Search, then use Add to Home in its menu or on its page.
        </p>
        <Button variant="ghost" onClick={search}>
          <Search aria-hidden="true" />
          Search
        </Button>
        <Button variant="ghost" onClick={done}>
          Close
        </Button>
      </div>
    </div>
  );
}

function AddToHomeForm({
  target,
  anchor,
  done,
}: {
  target: AddTarget;
  anchor: HTMLElement | null;
  done: () => void;
}) {
  const { credentials, changeSection } = useShell();
  const { connected } = useSessionGate();
  const follows = useHomeFollows();
  const page = useQuery({
    ...providerPageQuery(credentials, target.provider, { url: target.url }),
    enabled: connected,
  });
  const source = providerNames[target.provider];
  const lists = page.data ? followable(target, page.data) : [];
  const [chosen, setChosen] = useState<string>();
  const choice = lists.find((list) => list.url === chosen) ?? lists[0];
  // A season or a set is named for its series or programme.
  const [draft, setDraft] = useState<string>();
  const name = draft ?? (page.data?.parent?.title || target.title);
  const followed = choice && follows.find((follow) => follow.url === choice.url);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!choice) return;
    // Read before the panel closes: Undo shows beside the control that opened it.
    const control = controlBox(anchor);
    done();
    if (followed) {
      goToFollow(followed.id, changeSection);
      return;
    }
    const added = name.trim();
    const undo = addHomeFollow({
      id: followId(choice.url),
      provider: target.provider,
      url: choice.url,
      name: added,
      list: choice.list,
    });
    undoable(`${added} is on Home.`, undo, undefined, control);
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <PopoverHeader>
        <PopoverTitle className="font-heading text-base font-semibold">
          Add {target.title} to Home
        </PopoverTitle>
        <PopoverDescription>
          A section of its own with what {source} lists here, fresh each time Home opens. It stays
          on this device.
        </PopoverDescription>
      </PopoverHeader>
      {page.isPending && connected ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Asking {source}…
        </p>
      ) : page.error || !connected ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground"
        >
          Couldn't reach {source}.
          <Button type="button" variant="ghost" size="sm" onClick={() => void page.refetch()}>
            {TRY_AGAIN}
          </Button>
        </p>
      ) : (
        lists.length > 1 && (
          <Field>
            <FieldLabel>Follow</FieldLabel>
            <ChoiceGroup
              label="Follow"
              orientation="vertical"
              value={choice?.url ?? ""}
              onValueChange={setChosen}
              options={lists.map((list) => ({
                value: list.url,
                label: list.list,
                count: follows.some((follow) => follow.url === list.url) ? "On Home" : undefined,
              }))}
            />
          </Field>
        )
      )}
      {!followed && (
        <Field>
          <FieldLabel htmlFor="add-to-home-name">Name</FieldLabel>
          <Input
            id="add-to-home-name"
            autoComplete="off"
            maxLength={120}
            value={name}
            onChange={(event) => setDraft(event.target.value)}
            required
          />
        </Field>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={done}>
          Cancel
        </Button>
        <Button type="submit" disabled={!choice || !name.trim()}>
          {followed ? "Show on Home" : "Add to Home"}
        </Button>
      </div>
    </form>
  );
}

/** What a playing item belongs to that Home can follow: its season or list, else its channel. */
function entryTarget(entry: QueueEntry): AddTarget | undefined {
  const [outer, inner] = collectionLinks(entry.collection);
  const list = inner ?? outer;
  if (list)
    return { provider: list.provider, url: list.url, title: inner ? outer!.title : list.title };
  const provider = entry.creator && providerForUrl(entry.creator.url);
  if (provider) return { provider, url: entry.creator!.url, title: entry.creator!.title };
}

// A YouTube channel's tabs Home can follow, in the order a playing video belongs to them: a live one to Live streams.
const channelTabs = (live: boolean) =>
  live ? ["streams", "videos", "shorts"] : ["videos", "shorts", "streams"];

/**
 * The followed section a playing item's list is: its season or list itself, or for a YouTube channel the tab it plays
 * from (a live video's Live streams first).
 */
function followedFor(entry: QueueEntry, target: AddTarget, follows: HomeFollow[]) {
  const same = follows.find((follow) => follow.url === target.url);
  if (same || target.provider !== "youtube" || target.url !== entry.creator?.url) return same;
  const channel = target.url.replace(/\/+$/, "");
  return channelTabs(!!entry.endless)
    .map((tab) => follows.find((follow) => follow.url === `${channel}/${tab}`))
    .find(Boolean);
}

/**
 * The player's Add to Home for what plays, beside where it comes from. Once its list is on Home, "On Home" takes the
 * person to that section; a section hidden there says so, and shows again as it is opened.
 */
export function AddToHomeButton({ entry }: { entry: QueueEntry }) {
  const { changeSection } = useShell();
  const follows = useHomeFollows();
  const { rows } = useHomeRows();
  const target = entryTarget(entry);
  if (!target) return null;
  const followed = followedFor(entry, target, follows);
  if (followed) {
    const hidden = rows.some((row) => row.id === followed.id && !row.shown);
    return (
      <Button
        variant="ghost"
        size="sm"
        className="-mx-2"
        aria-label={hidden ? `Show ${followed.name} on Home` : `${followed.name} on Home`}
        onClick={() => goToFollow(followed.id, changeSection)}
      >
        <House aria-hidden="true" />
        {hidden ? "Hidden on Home" : "On Home"}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-mx-2"
      onClick={(event) => addToHome(target, event.currentTarget)}
    >
      <HousePlus aria-hidden="true" />
      Add to Home
    </Button>
  );
}
