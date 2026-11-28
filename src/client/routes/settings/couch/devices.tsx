import { createFileRoute } from "@tanstack/react-router";
import { DevicesPage } from "../../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/couch/devices")({
  // The desktop app's Pair a device… opens this page with its pairing code.
  validateSearch: (search): { pair?: true } => (search.pair === true ? { pair: true } : {}),
  component: DevicesRoute,
});

function DevicesRoute() {
  const { pair } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DevicesPage
      pairing={pair === true}
      onPairingShown={() => void navigate({ search: {}, replace: true })}
    />
  );
}
