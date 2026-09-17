import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { SettingsNav } from "./SettingsNav";

type Props = { section: SettingsPage; children: React.ReactNode };

export function SettingsLayout({ section, children }: Props) {
  const sourcePage = section.startsWith("source-");
  return (
    <section aria-label="Settings" className="min-w-0" data-page="Settings" data-tv-local-only={sourcePage ? "" : undefined}>
      <div className="grid items-start gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
        <SettingsNav active={section} />
        <div className="min-w-0 max-w-3xl">
          <header className="mb-6 flex min-h-11 flex-col items-start gap-4">
            <h2 className="text-xl font-semibold" tabIndex={-1}>{settingsPages[section].label}</h2>
          </header>
          {children}
        </div>
      </div>
    </section>
  );
}
