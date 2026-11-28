import { useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { undoable } from "@/toasts";
import { providerNames } from "../../../shared/providers";
import { useHomeFollows, type FollowId, type HomeFollow } from "./home-follows";
import { removeHomeFollow, type HomeSectionId } from "./home-rows";
import { RenameSection } from "./FollowShelf";
import { AddSectionPanel } from "./AddToHome";

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
          undoable(
            `${follow.name} removed from Home. Saved items and what you played stay.`,
            removeHomeFollow(follow.id),
          );
          next?.querySelector<HTMLElement>('[role="switch"]')?.focus();
        }}
      >
        <X aria-hidden="true" />
      </Button>
      <RenameSection follow={follow} anchor={renaming} onClose={() => setRenaming(null)} />
    </>
  );
}

/** Edit Home's Add a section: from what you've played and saved, or anything Search finds. */
export function AddSection() {
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  return (
    <Field orientation="horizontal" className="items-center gap-4 border-b py-3">
      <FieldContent className="min-w-0 flex-1 gap-0.5">
        <FieldTitle className="text-body font-medium">Add a section</FieldTitle>
        <FieldDescription className="text-meta">
          A series, programme or channel you've played or saved, or anything you find in Search.
        </FieldDescription>
      </FieldContent>
      <Button
        variant="outline"
        aria-label="Add a section"
        onClick={(event) => setAdding(event.currentTarget)}
      >
        <Plus aria-hidden="true" />
        Add
      </Button>
      <AddSectionPanel anchor={adding} onClose={() => setAdding(null)} />
    </Field>
  );
}
