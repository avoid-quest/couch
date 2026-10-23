import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { useSessionGate } from "@/session/session-context";
import { cn } from "@/lib/utils";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { SettingsNav } from "./SettingsNav";
import { useSettingsScope } from "./settings-scope";

/**
 * Settings rail and page. The selected rail item names the page; below md there is no rail, so the page's owner leads into
 * its title, back to the `/settings` index. A source's own page names itself under Sources at every width.
 */
export function SettingsLayout({ section, children }: { section: SettingsPage; children: ReactNode }) {
  const { tvPresentation } = useSessionGate();
  const { host, couch } = useSettingsScope();
  const page = settingsPages[section];
  const source = section.startsWith("source-");
  const owner = !host && page.owner === "device" ? "This device" : couch;
  // Each crumb returns the focus to the entry that leads here.
  const crumbs = [
    { label: owner, to: "/settings", focus: `[data-settings-page="${source ? "sources" : section}"]`, className: "md:hidden" },
    ...source ? [{ label: "Sources", to: settingsPages.sources.path, focus: `[data-settings-content] a[href="${page.path}"]`, className: undefined }] : [],
  ];
  return (
    <section aria-label="Settings" data-page="Settings" className="grid min-w-0 items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
      <SettingsNav active={section} />
      <div className="min-w-0 max-w-3xl" data-nav-content data-settings-content data-tv-local-only={source ? "" : undefined} onKeyDown={event => {
        if (!tvPresentation || source || event.defaultPrevented || !["Escape", "BrowserBack"].includes(event.key)) return;
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        const navigation = [...document.querySelectorAll<HTMLElement>(`[data-nav-rail] [data-settings-page="${section}"]`)]
          .find(element => element.getClientRects().length > 0 && !element.matches(":disabled") && !element.closest("[inert]"));
        navigation?.focus();
        if (document.activeElement !== navigation) return;
        event.preventDefault(); event.stopPropagation();
      }}>
        <PageHeader title={page.label} hidden={source ? false : "md"} className={source ? undefined : "md:mb-0"} breadcrumb={<Breadcrumb aria-label="Settings path" className={source ? undefined : "md:hidden"}>
          <BreadcrumbList className="text-sm">
            {/* Back (Esc, the TV's Back) goes up to the nearest crumb, which returns the focus to this page's entry. */}
            {crumbs.map((crumb, index) => <Fragment key={crumb.to}>
              <BreadcrumbItem className={cn("min-w-0", crumb.className)}><BreadcrumbLink asChild><Link data-back={index === crumbs.length - 1 || undefined} to={crumb.to} state={{ detailFocus: { selector: crumb.focus, index: 0 } }} className="block truncate leading-8 touch:leading-11">{crumb.label}</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator className={crumb.className} />
            </Fragment>)}
            <BreadcrumbItem className="min-w-0"><BreadcrumbPage className="block truncate leading-8 touch:leading-11">{page.label}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>} />
        <div className="flex min-w-0 flex-col gap-8">{children}</div>
      </div>
    </section>
  );
}
