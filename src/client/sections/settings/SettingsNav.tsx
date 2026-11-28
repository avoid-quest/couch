import { useId, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Lock, Sofa } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { useSessionGate } from "@/session/session-context";
import { focusPageControl } from "@/navigation";
import { useUpdatesReady } from "@/sections/updates/UpdateCue";
import { useSettingsGroups, type SettingsGroup } from "./settings-scope";
import { DeviceGlyph } from "./ScopeLine";

/**
 * Settings' pages under their owners: a rail with the current one marked on wide screens; below md, `/settings` lists the
 * same groups (`index`). A page this device can't change at all ends in a lock, and still opens; Updates says when one is ready.
 */
export function SettingsNav({ active, index = false }: { active?: SettingsPage; index?: boolean }) {
  const navigate = useNavigate();
  const { tvPresentation } = useSessionGate();
  const groups = useSettingsGroups();
  const ready = useUpdatesReady() > 0;
  const current = active?.startsWith("source-") ? "sources" : active;
  return (
    <nav
      data-nav-rail={index ? undefined : ""}
      aria-label="Settings pages"
      className={
        index
          ? "grid gap-7"
          : "hidden min-w-0 flex-col gap-6 md:sticky md:top-[calc(var(--top-bar,4rem)+2rem)] md:flex"
      }
    >
      {groups.map((group, position) => (
        <Group key={group.owner} group={group}>
          {group.pages.map(({ id, locked }, row) => {
            const badge = ready && (id === "updates" || id === "device-updates");
            return (
              <Button
                key={id}
                variant="ghost"
                asChild
                // The rail's items are pills (index.css squares other rails' rows).
                className={cn(
                  "w-full justify-start gap-2 text-body font-normal",
                  index
                    ? "h-auto min-h-12 rounded-lg px-3 py-3"
                    : "h-9 min-h-9! rounded-full! touch:min-h-11! px-3 text-sm text-muted-foreground hover:text-foreground aria-[current=page]:bg-secondary aria-[current=page]:font-normal! aria-[current=page]:text-foreground",
                )}
              >
                <Link
                  data-settings-page={id}
                  activeOptions={{ exact: true }}
                  data-page-first={
                    (index ? position === 0 && row === 0 : current === id) || undefined
                  }
                  aria-current={current === id ? "page" : undefined}
                  to={settingsPages[id].path}
                  onClick={(event) => {
                    if (
                      index ||
                      !tvPresentation ||
                      event.button ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    void navigate({ to: settingsPages[id].path }).then(() => {
                      const content =
                        document.querySelector<HTMLElement>("[data-settings-content]");
                      if (content) focusPageControl(content);
                    });
                  }}
                >
                  <span className="min-w-0 truncate">{settingsPages[id].label}</span>
                  {badge && <span className="ml-auto shrink-0 text-meta">Update ready</span>}
                  {locked && (
                    <>
                      <Lock
                        aria-hidden="true"
                        className={cn("size-3.5 opacity-65", !badge && "ml-auto")}
                      />
                      <span className="sr-only">, only an admin can change it</span>
                    </>
                  )}
                  {index && (
                    <ChevronRight
                      aria-hidden="true"
                      className={cn("text-muted-foreground", !locked && !badge && "ml-auto")}
                    />
                  )}
                </Link>
              </Button>
            );
          })}
        </Group>
      ))}
    </nav>
  );
}

/** An owner's pages under its name and who changes there reach: this device's name, then the Couch's. */
function Group({ group, children }: { group: SettingsGroup; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="grid min-w-0">
      <div className="flex min-w-0 items-center gap-2.5 px-3 pb-2">
        {group.owner === "couch" ? (
          <Sofa aria-hidden="true" className="size-4.5 shrink-0 text-muted-foreground" />
        ) : (
          <DeviceGlyph className="size-4.5 shrink-0 text-muted-foreground" />
        )}
        <div id={id} className="grid min-w-0">
          <h2 className="truncate font-heading text-body font-semibold">{group.title}</h2>
          <p className="truncate text-meta text-muted-foreground">{group.subtitle}</p>
        </div>
      </div>
      <div className="grid">{children}</div>
    </div>
  );
}

/** `/settings` below md: both owners' pages as a list. */
export function SettingsIndex() {
  return (
    <section aria-label="Settings" data-page="Settings">
      <PageHeader title="Settings" hidden />
      <SettingsNav index />
    </section>
  );
}
