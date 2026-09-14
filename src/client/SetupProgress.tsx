import { setupSteps, type SetupStep } from "../shared/setup";

export function SetupProgress({ step, host, administrator, administratorClaimed }: { step: SetupStep; host: boolean; administrator: boolean; administratorClaimed: boolean }) {
  const labels = { general: "Name", display: "Screen", sound: "Sound", sources: "Optional sources", complete: "Ready" };
  return <div className="space-y-2" aria-live="polite">
    <p className="font-medium">Step {setupSteps.indexOf(step) + 1} of 4 · {labels[step]}</p>
    {!host && !administrator ? <p>{administratorClaimed ? "Your administrator is setting up this TV. You can continue when setup is finished." : "Manage setup on the playback computer."}</p>
      : <p>{step === "general" ? "Choose a name, save it, then continue." : step === "display" ? "Preview and keep the screen you want, then confirm you can see Couch there." : step === "sound" ? "Choose an output and play the test sound before continuing." : "Add a folder on the TV or connect Jellyfin. You can finish without a source or Internet access and add one later in Settings."}</p>}
  </div>;
}
