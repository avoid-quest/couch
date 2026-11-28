import { useEffect, useEffectEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { couchApp } from "@/session/native-context";
import { errorText, useSessionGate } from "@/session/session-context";
import { useSettingsScope } from "@/sections/settings/settings-scope";
import { sharedWhat, viewersOf } from "@/sections/share/share";
import { updatesPage } from "@/sections/updates/update-presentation";
import { trayLabelLength, type TrayAction, type TrayStatus } from "../../../shared/app-bridge";
import { settingsPages } from "../../../shared/settings-pages";

// As many devices as fit the tray's label, then how many more: "Sharing screen on Living room TV and 3 more". A
// device's name is short enough that the first always fits.
const sharingLabel = (what: string, where: string[]) => {
  let shown = where.length;
  const label = () =>
    `Sharing ${what}${shown ? ` on ${where.slice(0, shown).join(", ")}` : ""}${shown < where.length ? ` and ${where.length - shown} more` : ""}`;
  while (shown > 1 && label().length > trayLabelLength) shown--;
  return label();
};

/** The desktop app's tray (app/tray.ts): this Couch and its connection, this window's sharing, and pages it opens. */
export function useTrayStatus(connection: string) {
  const { state, localLiveSourceId, remoteControlEnabled, endLive, setError } = useSessionGate();
  const { couch, administrator } = useSettingsScope();
  const router = useRouter();
  const source = state?.liveSources?.find((item) => item.id === localLiveSourceId);
  const where = source ? viewersOf(state, source.id).map((viewer) => viewer.device.name) : [];
  const status: TrayStatus = {
    couch,
    connection,
    network: remoteControlEnabled,
    sharing: source ? sharingLabel(sharedWhat(source), where) : null,
    pair: administrator,
  };
  const key = JSON.stringify(status);
  useEffect(() => {
    void couchApp?.trayStatus?.(status).catch(() => {});
  }, [key]);
  const act = useEffectEvent((action: TrayAction) => {
    if (action === "stop-sharing") {
      endLive().catch((reason) => setError(errorText(reason)));
      return;
    }
    if (action === "pair")
      void router.navigate({ to: settingsPages.devices.path, search: { pair: true } });
    else
      void router.navigate({
        to:
          action === "updates"
            ? settingsPages[updatesPage(administrator) ?? "device"].path
            : "/settings",
      });
  });
  useEffect(() => couchApp?.onTrayAction?.(act), []);
}
