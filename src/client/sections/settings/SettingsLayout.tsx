import { Children } from "react";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { Card } from "@/components/ui/card";
import { SettingsNav } from "./SettingsNav";
import { useOptionalShell } from "@/sections/shell/shell-context";

type Props = { section: SettingsPage; children: React.ReactNode };

export function SettingsLayout({ section, children }: Props) {
  const redesigned = useOptionalShell()?.standardLayout;
  const sourcePage = section.startsWith("source-");
  return (
    <section aria-label="Settings" className="min-w-0" data-page="Settings" data-tv-navigation-scope="" data-tv-local-only={sourcePage ? "" : undefined}>
      <div className={`settings-grid grid items-start gap-6 isolate ${redesigned ? "settings-page-layout" : ""}`}>
        <SettingsNav active={section} />
        <div className="settings-page-content relative z-10 min-w-0">
          <header className={redesigned ? "mb-5" : "mb-6 flex min-h-11 flex-col items-start gap-4"}>
            <h1 className={redesigned ? "text-[2rem] font-semibold tracking-tight" : "text-xl font-semibold"} tabIndex={-1}>{settingsPages[section].label}</h1>
          </header>
          <div className={redesigned ? "space-y-6" : "space-y-4"}>
            {Children.toArray(children).map((child, index) => (
              redesigned ? <div key={index} className="settings-flat-section">{child}</div> : <Card key={index} className="gap-4 rounded-2xl px-7 py-6 shadow-none">{child}</Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
