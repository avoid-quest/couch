import { PageHeader } from "@/components/PageHeader";
import { useDetailNavigation } from "@/detail-navigation";
import { useSessionGate } from "@/session/session-context";
import { Overview } from "./Outputs";

/** Where it plays' overview, opened from the picker's "Every device". Not a tab: Back returns to the page that opened it. */
export function WhereItPlaysPage() {
  const { state, connected, run } = useSessionGate();
  const navigation = useDetailNavigation();
  return <section data-page="Where it plays">
    {/* A phone's top bar already names the page, and a TV's remote has its own Back. */}
    <PageHeader title="Where it plays" back={{ label: "Back", onClick: () => navigation.back("/") }} className="touch:[&_h1]:sr-only tv:[&_[data-back]]:hidden" />
    {state && <Overview state={state} connected={connected} run={run} />}
  </section>;
}
