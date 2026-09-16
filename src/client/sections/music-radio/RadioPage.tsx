import { RadioPanel } from "./RadioPanel";
import { useShell } from "../../shell";

export function RadioPage() {
  const shell = useShell();
  const { credentials, state, connected, available, active, host, openSources, enqueueRadio } = shell;
  const current = state?.queue.find(entry => entry.id === state.currentEntryId);
  return <section data-page="Radio" className="space-y-6">
    <RadioPanel credentials={credentials} connected={connected} canPlay={available} active={active} currentStationId={state?.radioProgramme?.stationId ?? current?.id} host={!!host} onManage={() => openSources("radio")} onEnqueue={enqueueRadio} />
  </section>;
}
