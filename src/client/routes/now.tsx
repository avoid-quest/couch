import { createFileRoute } from "@tanstack/react-router";
import { NowPage } from "../sections/now/NowPage";

export const Route = createFileRoute("/now")({
  validateSearch: (search: Record<string, unknown>): { queue?: boolean } => ({ queue: search.queue === true || search.queue === "true" ? true : undefined }),
  component: NowRoute,
});

function NowRoute() {
  const { queue } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <NowPage queueOpen={queue === true} onQueueOpenChange={open => void navigate({ search: { queue: open || undefined }, replace: true })} />;
}
