import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { ADMIN_ONLY } from "@/copy";
import { useSessionGate } from "@/session/session-context";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { SettingsNav } from "./SettingsNav";

/** Settings rail and page title. Admin pages show one read-only line to everyone else. */
export function SettingsLayout({ section, children }: { section: SettingsPage; children: ReactNode }) {
  const navigate = useNavigate();
  const { identity, tvPresentation } = useSessionGate();
  const page = settingsPages[section];
  const source = section.startsWith("source-");
  const administrator = identity?.authority === "host" || identity?.authority === "administrator";
  const locked = page.manage === "administrator" && !administrator && !(section === "connection" && identity?.claimAvailable);
  return (
    <section aria-label="Settings" data-page="Settings" className="grid min-w-0 items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
      <SettingsNav active={section} />
      <div className="min-w-0 max-w-3xl" data-settings-content data-tv-local-only={source ? "" : undefined} onKeyDown={event => {
        if (!tvPresentation || source || event.defaultPrevented || !["Escape", "BrowserBack"].includes(event.key)) return;
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        event.preventDefault(); event.stopPropagation();
        document.querySelector<HTMLElement>(`[data-settings-page="${section}"]`)?.focus();
      }}>
        <PageHeader title={page.label} back={source ? { label: "Sources", onClick: () => void navigate({ to: settingsPages.sources.path }) } : undefined} />
        <div className="flex min-w-0 flex-col gap-8">
          {locked ? <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p> : children}
        </div>
      </div>
    </section>
  );
}
