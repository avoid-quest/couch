import { createFileRoute } from "@tanstack/react-router";
import { readPlayerSearch } from "../session/player-control";
import { CouchPlayer } from "../components/CouchPlayer";
import { useSessionGate } from "../session/session-context";
import { NowPage } from "../sections/now/NowPage";

export const Route = createFileRoute("/now")({
  validateSearch: readPlayerSearch,
  component: NowRoute,
});

function NowRoute() {
  const { queue } = Route.useSearch();
  const { state, run } = useSessionGate();
  const navigate = Route.useNavigate();
  return (
    <CouchPlayer state={state} run={run}>
      <NowPage
        queueOpen={queue === true}
        onQueueOpenChange={(open) =>
          void navigate({
            search: (previous) => ({ ...previous, queue: open || undefined }),
            replace: true,
            state: (previous) => previous,
          })
        }
      />
    </CouchPlayer>
  );
}
