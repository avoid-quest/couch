import { useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { useShell } from "@/sections/shell/shell-context";
import { undoable } from "@/toasts";
import { providerNames } from "../../../shared/providers";
import { useHomeFollows, type FollowId, type HomeFollow } from "./home-follows";
import { removeHomeFollow, type HomeSectionId } from "./home-rows";
import { RenameSection } from "./FollowShelf";

/** Edit Home's lines for the sections that follow a source: each one's name, what it follows, Rename and Remove. */
export function useFollowedRows() {
  const follows = useHomeFollows();
  const rows = Object.fromEntries(
    follows.map((follow) => [
      follow.id,
      { label: follow.name, note: `Follows ${follow.list} on ${providerNames[follow.provider]}` },
    ]),
  ) as Record<FollowId, { label: string; note: string }>;
  const actions = (id: HomeSectionId) => {
    const follow = follows.find((other) => other.id === id);
    return follow && <FollowedActions follow={follow} />;
  };
  return { rows, actions };
}

function FollowedActions({ follow }: { follow: HomeFollow }) {
  const [renaming, setRenaming] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Rename ${follow.name}`}
        title="Rename"
        onClick={(event) => setRenaming(event.currentTarget)}
      >
        <Pencil aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${follow.name} from Home`}
        title="Remove from Home"
        onClick={(event) => {
          // Its line goes: the focus goes on to the next line's Switch, else the one before.
          const line = event.currentTarget.closest("li");
          const next = line?.nextElementSibling ?? line?.previousElementSibling;
          undoable(`${follow.name} is off Home.`, removeHomeFollow(follow.id));
          next?.querySelector<HTMLElement>('[role="switch"]')?.focus();
        }}
      >
        <X aria-hidden="true" />
      </Button>
      <RenameSection follow={follow} anchor={renaming} onClose={() => setRenaming(null)} />
    </>
  );
}

/** Edit Home's Add a section: a section follows a page's list, so it starts in Search, which finds the page. */
export function AddSection() {
  const { focusSearch } = useShell();
  return (
    <Field orientation="horizontal" className="items-center gap-4 border-b py-3">
      <FieldContent className="min-w-0 flex-1 gap-0.5">
        <FieldTitle className="text-body font-medium">Add a section</FieldTitle>
        <FieldDescription className="text-meta">
          Find a series, programme or channel in Search, then choose Add to Home in its … menu.
        </FieldDescription>
      </FieldContent>
      <Button variant="outline" aria-label="Add a section" onClick={focusSearch}>
        <Plus aria-hidden="true" />
        Add
      </Button>
    </Field>
  );
}
