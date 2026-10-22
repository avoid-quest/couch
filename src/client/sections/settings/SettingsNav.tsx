import { useId, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { useSessionGate } from "@/session/session-context";
import { focusPageControl } from "@/navigation";
import { useSettingsGroups, type SettingsGroup } from "./settings-scope";

/**
 * Settings' pages under their owners: a rail with the current one marked on wide screens; below md, `/settings` lists the
 * same groups as divided rows (`index`). A page this device can't change at all ends in a lock, and still opens.
 */
export function SettingsNav({ active, index = false }: { active?: SettingsPage; index?: boolean }) {
  const navigate = useNavigate();
  const { tvPresentation } = useSessionGate();
  const groups = useSettingsGroups();
  const current = active?.startsWith("source-") ? "sources" : active;
  return <nav data-nav-rail={index ? undefined : ""} aria-label="Settings pages" className={index ? "grid gap-10" : "hidden min-w-0 flex-col gap-8 md:sticky md:top-[calc(var(--top-bar,4rem)+2rem)] md:flex"}>
    {groups.map((group, position) => <Group key={group.title} group={group} index={index}>
      {group.pages.map(({ id, locked }, row) => (
        <Button key={id} variant="ghost" asChild className={index
          ? "h-auto min-h-12 w-full justify-start gap-2 rounded-none px-0 py-3 text-base font-normal"
          : "h-10 w-full justify-start gap-2 rounded-none border-y-0 border-r-0 border-l-2 border-transparent pl-3 font-normal text-muted-foreground aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"}>
          <Link data-settings-page={id} activeOptions={{ exact: true }} data-page-first={(index ? position === 0 && row === 0 : current === id) || undefined} aria-current={current === id ? "page" : undefined} to={settingsPages[id].path} onClick={event => {
            if (index || !tvPresentation || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void navigate({ to: settingsPages[id].path }).then(() => {
              const content = document.querySelector<HTMLElement>("[data-settings-content]");
              if (content) focusPageControl(content);
            });
          }}>
            <span className="min-w-0 truncate">{settingsPages[id].label}</span>
            {locked && <><Lock aria-hidden="true" className="ml-auto size-3.5 opacity-65" /><span className="sr-only">, only an admin can change it</span></>}
            {index && <ChevronRight aria-hidden="true" className={cn("text-muted-foreground", !locked && "ml-auto")} />}
          </Link>
        </Button>
      ))}
    </Group>)}
  </nav>;
}

/** An owner's pages under its name and a muted line: this device's name, or the Couch's connection and your role. */
function Group({ group, index, children }: { group: SettingsGroup; index: boolean; children: ReactNode }) {
  const id = useId();
  return <div role="group" aria-labelledby={id} className="grid min-w-0">
    <div className={cn("grid min-w-0 gap-0.5 pb-2", !index && "pl-3.5")}>
      <h2 id={id} className={cn("truncate font-medium", index ? "text-xl tracking-tight" : "text-sm")}>{group.title}</h2>
      <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        {group.connected !== undefined && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", group.connected ? "bg-foreground" : "border border-current")} />}
        <span className="truncate">{group.subtitle}</span>
      </p>
    </div>
    <div className={index ? "divide-y border-y" : "grid"}>{children}</div>
  </div>;
}

/** `/settings` below md: both owners' pages as divided rows. */
export function SettingsIndex() {
  return <section aria-label="Settings" data-page="Settings">
    <PageHeader title="Settings" hidden />
    <SettingsNav index />
  </section>;
}
