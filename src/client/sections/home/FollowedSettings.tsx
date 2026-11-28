import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { controlBox, undoable } from "@/toasts";
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
          const box = controlBox(event.currentTarget);
          undoable(`${follow.name} is off Home.`, removeHomeFollow(follow.id), undefined, box);
        }}
      >
        <X aria-hidden="true" />
      </Button>
      <RenameSection follow={follow} anchor={renaming} onClose={() => setRenaming(null)} />
    </>
  );
}
