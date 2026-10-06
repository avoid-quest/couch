import { createFileRoute } from "@tanstack/react-router";
import { readPlayerSearch } from "../session/player-control";
import { NowPage } from "../sections/now/NowPage";

export const Route = createFileRoute("/now")({
  validateSearch: readPlayerSearch,
  component: NowRoute,
});

function NowRoute() {
  const { queue } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <NowPage queueOpen={queue === true} onQueueOpenChange={open => void navigate({ search: previous => ({ ...previous, queue: open || undefined }),
    replace: true, state: previous => previous })} />;
}
