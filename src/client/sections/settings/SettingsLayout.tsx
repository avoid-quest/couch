import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useSessionGate } from "@/session/session-context";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { SettingsNav } from "./SettingsNav";

/** Settings rail and page. The selected rail item names the page; a source's own page names itself under ‹ Sources. */
export function SettingsLayout({ section, children }: { section: SettingsPage; children: ReactNode }) {
  const navigate = useNavigate();
  const { tvPresentation } = useSessionGate();
  const page = settingsPages[section];
  const source = section.startsWith("source-");
  return (
    <section aria-label="Settings" data-page="Settings" className="grid min-w-0 items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
      <SettingsNav active={section} />
      <div className="min-w-0 max-w-3xl" data-nav-content data-settings-content data-tv-local-only={source ? "" : undefined} onKeyDown={event => {
        if (!tvPresentation || source || event.defaultPrevented || !["Escape", "BrowserBack"].includes(event.key)) return;
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        const navigation = [...document.querySelectorAll<HTMLElement>(`[data-settings-page="${section}"], [aria-label="Settings page"]`)]
          .find(element => element.getClientRects().length > 0 && !element.matches(":disabled") && !element.closest("[inert]"));
        navigation?.focus();
        if (document.activeElement !== navigation) return;
        event.preventDefault(); event.stopPropagation();
      }}>
        <PageHeader title={page.label} hidden={!source} back={source ? { label: "Sources", onClick: () => void navigate({ to: settingsPages.sources.path }) } : undefined} />
        <div className="flex min-w-0 flex-col gap-8">{children}</div>
      </div>
    </section>
  );
}
