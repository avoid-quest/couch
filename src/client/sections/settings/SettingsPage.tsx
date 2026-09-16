import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { useShell } from "../../shell";
import { SettingsLayout } from "./SettingsLayout";
import { PlaceholderSettings } from "./PlaceholderSettings";
import { SettingsSources } from "./SettingsSources";
import type { SourceKind } from "./sources/sourceTypes";

export function SettingsPage({ section }: { section: SettingsPage }) {
  const shell = useShell();
  const { credentials, connected, host, identity } = shell;
  const source = section.startsWith("source-") ? section.slice(7) : undefined;

  return (
    <SettingsLayout section={section}>
      {source ? <SettingsSources canManage={!!host || identity?.authority === "administrator"} connected={connected} credentials={credentials} source={source as SourceKind} />
        : section === "sources" ? <SettingsSources canManage={!!host || identity?.authority === "administrator"} connected={connected} credentials={credentials} />
        : <PlaceholderSettings page={settingsPages[section].label} />}
    </SettingsLayout>
  );
}
