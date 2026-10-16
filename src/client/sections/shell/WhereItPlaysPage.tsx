import { PageHeader } from "@/components/PageHeader";
import { useDetailNavigation } from "@/detail-navigation";
import { useSessionGate } from "@/session/session-context";
import { Overview } from "./Outputs";

/** Where it plays' overview, opened from the picker's "Every device". Not a tab: Back returns to the page that opened it. */
export function WhereItPlaysPage() {
  const { state, connected, run } = useSessionGate();
  const navigation = useDetailNavigation();
  return <section data-page="Where it plays">
    {/* A pointer needs Back; a TV's remote has its own. */}
    <PageHeader title="Where it plays" back={{ label: "Back", onClick: () => navigation.back("/") }} className="tv:[&_[data-back]]:hidden" />
    {state && <Overview state={state} connected={connected} run={run} />}
  </section>;
}
