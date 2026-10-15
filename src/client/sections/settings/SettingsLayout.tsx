import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useSessionGate } from "@/session/session-context";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { SettingsNav } from "./SettingsNav";
import { useSettingsScope } from "./settings-scope";

/** Settings rail and page title, under the scope it belongs to: this device or the shared Couch. */
export function SettingsLayout({ section, title, children }: { section: SettingsPage; title?: string; children: ReactNode }) {
  const navigate = useNavigate();
  const { tvPresentation } = useSessionGate();
  const scope = useSettingsScope();
  const page = settingsPages[section];
  const source = section.startsWith("source-");
  const eyebrow = page.scope === "device" ? `This device · ${scope.device}`
    : "group" in page && page.group === "Hardware" ? `${scope.couch} · Shared hardware`
    : `${scope.couch} · Shared${scope.host ? " · This device" : ""}`;
  return (
    <section aria-label="Settings" data-page="Settings" className="grid min-w-0 items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
      <SettingsNav active={section} />
      <div className="min-w-0 max-w-3xl" data-settings-content data-tv-local-only={source ? "" : undefined} onKeyDown={event => {
        if (!tvPresentation || source || event.defaultPrevented || !["Escape", "BrowserBack"].includes(event.key)) return;
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        const navigation = [...document.querySelectorAll<HTMLElement>(`[data-settings-page="${section}"], [aria-label="Settings page"]`)]
          .find(element => element.getClientRects().length > 0 && !element.matches(":disabled") && !element.closest("[inert]"));
        navigation?.focus();
        if (document.activeElement !== navigation) return;
        event.preventDefault(); event.stopPropagation();
      }}>
        <p className="mb-1 truncate text-xs text-muted-foreground" data-settings-scope={page.scope}>{eyebrow}</p>
        <PageHeader title={title ?? page.label} back={source ? { label: "Sources", onClick: () => void navigate({ to: settingsPages.sources.path }) } : undefined} />
        <div className="flex min-w-0 flex-col gap-8">{children}</div>
      </div>
    </section>
  );
}
