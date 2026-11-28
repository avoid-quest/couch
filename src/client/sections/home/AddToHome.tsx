import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { House, HousePlus } from "lucide-react";
import { providerPageQuery } from "@/api/providers";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { collectionLinks } from "@/collection-target";
import { TRY_AGAIN } from "@/copy";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { undoable } from "@/toasts";
import type { QueueEntry } from "../../../shared/protocol";
import {
  providerForUrl,
  providerNames,
  type ProviderId,
  type ProviderPage,
} from "../../../shared/providers";
import { followId, useHomeFollows } from "./home-follows";
import { addHomeFollow } from "./home-rows";

/** A series, show or channel that Home can follow: its page, whose lists are offered. */
export type AddTarget = { provider: ProviderId; url: string; title: string };
const opened = "couch.add-to-home";

/** Opens Add to Home for `target`, from any menu or page. */
export const addToHome = (target: AddTarget) =>
  window.dispatchEvent(new CustomEvent<AddTarget>(opened, { detail: target }));

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

/** Add to Home's one dialog, which any Add to Home opens. */
export function AddToHomeDialog() {
  const [target, setTarget] = useState<AddTarget | null>(null);
  // Opened from a menu or a button, it gives the focus back to that control as it closes.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTarget((event as CustomEvent<AddTarget>).detail);
    };
    window.addEventListener(opened, open);
    return () => window.removeEventListener(opened, open);
  }, []);
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
      {target && (
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
          }}
        >
          <AddToHomeForm key={target.url} target={target} done={() => setTarget(null)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function AddToHomeForm({ target, done }: { target: AddTarget; done: () => void }) {
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
    done();
    if (followed) {
      changeSection("Home");
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
    undoable(`${added} is on Home.`, undo);
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Add {target.title} to Home</DialogTitle>
        <DialogDescription>
          A section of its own with what {source} lists here, fresh each time Home opens. It stays
          on this device.
        </DialogDescription>
      </DialogHeader>
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
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={done}>
          Cancel
        </Button>
        <Button type="submit" disabled={!choice || !name.trim()}>
          {followed ? "Show on Home" : "Add to Home"}
        </Button>
      </DialogFooter>
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

/** The player's Add to Home for what plays, beside where it comes from; once on Home, it opens Home. */
export function AddToHomeButton({ entry }: { entry: QueueEntry }) {
  const { changeSection } = useShell();
  const follows = useHomeFollows();
  const target = entryTarget(entry);
  if (!target) return null;
  if (follows.some((follow) => follow.url === target.url))
    return (
      <Button variant="ghost" size="sm" className="-mx-2" onClick={() => changeSection("Home")}>
        <House aria-hidden="true" />
        On Home
      </Button>
    );
  return (
    <Button variant="ghost" size="sm" className="-mx-2" onClick={() => addToHome(target)}>
      <HousePlus aria-hidden="true" />
      Add to Home
    </Button>
  );
}
