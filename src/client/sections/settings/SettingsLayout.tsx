import { Children } from "react";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { SettingsNav } from "./SettingsNav";

type Props = { section: SettingsPage; children: React.ReactNode };

export function SettingsLayout({ section, children }: Props) {
  const sourcePage = section.startsWith("source-");
  return (
    <section aria-label="Settings" className="min-w-0" data-page="Settings">
      <div className="settings-grid settings-page-layout isolate grid items-start gap-6">
        <SettingsNav active={section} />
        <div className="settings-page-content relative z-10 min-w-0">
          <header className="mb-5">
            <h1 className="text-[2rem] font-semibold tracking-tight" tabIndex={-1}>{settingsPages[section].label}</h1>
          </header>
          <div className="space-y-6" data-tv-local-only={sourcePage ? "" : undefined}>
            {Children.toArray(children).map((child, index) => (
              <div key={index} className="settings-flat-section">{child}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
