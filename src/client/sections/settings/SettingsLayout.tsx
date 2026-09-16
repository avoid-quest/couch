import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { SettingsNav } from "./SettingsNav";

type Props = { section: SettingsPage; children: React.ReactNode };

export function SettingsLayout({ section, children }: Props) {
  const sourcePage = section.startsWith("source-");
  const backTo = sourcePage ? settingsPages.sources.path : "/settings";
  const backLabel = sourcePage ? "Sources" : "All settings";

  return (
    <section aria-label="Settings" className="min-w-0" data-page="Settings" data-tv-local-only={sourcePage ? "" : undefined}>
      <header className="mb-6"><h1 className="text-2xl font-semibold sm:text-3xl">Settings</h1></header>
      <div className="grid items-start gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
        <SettingsNav active={section} />
        <div className="min-w-0 max-w-3xl">
          <header className="mb-6 flex min-h-11 flex-col items-start gap-4">
            <Button variant="ghost" asChild className="-ml-3 h-auto min-h-11 w-auto justify-start lg:hidden">
              <Link to={backTo}><ArrowLeft aria-hidden="true" />{backLabel}</Link>
            </Button>
            <h2 className="text-xl font-semibold" tabIndex={-1}>{settingsPages[section].label}</h2>
          </header>
          {children}
        </div>
      </div>
    </section>
  );
}
