import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useSessionGate } from "@/session/session-context";
import { cn } from "@/lib/utils";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { ScopeLine } from "./ScopeLine";
import { SettingsNav } from "./SettingsNav";
import { useSettingsScope } from "./settings-scope";

/**
 * Settings rail and page. Each page opens with who its changes reach, then its title; below md there is no rail, so Settings
 * leads back to the `/settings` index. A source's own page names itself under Sources at every width.
 */
export function SettingsLayout({
  section,
  children,
}: {
  section: SettingsPage;
  children: ReactNode;
}) {
  const { tvPresentation } = useSessionGate();
  const { couch } = useSettingsScope();
  const page = settingsPages[section];
  const source = section.startsWith("source-");
  // Each crumb returns the focus to the entry that leads here.
  const crumbs = [
    {
      label: "Settings",
      to: "/settings",
      focus: `[data-settings-page="${source ? "sources" : section}"]`,
      className: "md:hidden",
    },
    ...(source
      ? [
          {
            label: "Sources",
            to: settingsPages.sources.path,
            focus: `[data-settings-content] a[href="${page.path}"]`,
            className: undefined,
          },
        ]
      : []),
  ];
  return (
    <section
      aria-label="Settings"
      data-page="Settings"
      className="grid min-w-0 items-start gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-9"
    >
      <SettingsNav active={section} />
      <div
        className="min-w-0 max-w-[37.5rem]"
        data-nav-content
        data-settings-content
        data-tv-local-only={source ? "" : undefined}
        onKeyDown={(event) => {
          if (
            !tvPresentation ||
            source ||
            event.defaultPrevented ||
            !["Escape", "BrowserBack"].includes(event.key)
          )
            return;
          if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target))
            return;
          const navigation = [
            ...document.querySelectorAll<HTMLElement>(
              `[data-nav-rail] [data-settings-page="${section}"]`,
            ),
          ].find(
            (element) =>
              element.getClientRects().length > 0 &&
              !element.matches(":disabled") &&
              !element.closest("[inert]"),
          );
          navigation?.focus();
          if (document.activeElement !== navigation) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <PageHeader
          title={page.label}
          className="mb-7"
          breadcrumb={
            <>
              <Breadcrumb aria-label="Settings path" className={source ? undefined : "md:hidden"}>
                <BreadcrumbList className="text-sm">
                  {/* Back (Esc, the TV's Back) goes up to the nearest crumb, which returns the focus to this page's entry. */}
                  {crumbs.map((crumb, index) => (
                    <Fragment key={crumb.to}>
                      {index > 0 && (
                        <BreadcrumbSeparator className={crumbs[index - 1]!.className} />
                      )}
                      <BreadcrumbItem className={cn("min-w-0", crumb.className)}>
                        <BreadcrumbLink asChild>
                          <Link
                            data-back={index === crumbs.length - 1 || undefined}
                            to={crumb.to}
                            state={{ detailFocus: { selector: crumb.focus, index: 0 } }}
                            className="flex items-center gap-1 truncate leading-8 touch:leading-11"
                          >
                            {!source && <ChevronLeft aria-hidden="true" className="-ml-1 size-4" />}
                            {crumb.label}
                          </Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                    </Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
              <ScopeLine owner={page.owner} couch={couch} />
            </>
          }
        />
        <div className="flex min-w-0 flex-col gap-7">{children}</div>
      </div>
    </section>
  );
}
