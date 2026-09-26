import type { SettingsPage } from "../../../shared/settings-pages";
import { useShell } from "@/sections/shell/AppShell";
import { deviceName } from "@/copy";
import { SettingsLayout } from "./SettingsLayout";
import { SettingsSources } from "./SettingsSources";
import type { SourceKind } from "@/components/sourceTypes";
import { useSessionGate } from "@/session/session-context";

// Routes render this page only for Sources and its per-source pages.
export function SettingsPage({ section }: { section: SettingsPage }) {
  const { credentials } = useShell();
  const { connected, host, identity, state, details } = useSessionGate();
  const source = section.startsWith("source-") ? section.slice(7) as SourceKind : undefined;
  return (
    <SettingsLayout section={section}>
      <SettingsSources canManage={!!host || identity?.authority === "administrator"} connected={connected} credentials={credentials} source={source} hostName={deviceName(state?.installationName ?? details?.name)} />
    </SettingsLayout>
  );
}
