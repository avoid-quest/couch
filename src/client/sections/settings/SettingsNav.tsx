import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";

type Props = { active: SettingsPage };

export function SettingsNav({ active }: Props) {
  const sourcePage = active.startsWith("source-");
  const visible = (id: string) => id !== "tv-appearance";
  const groups = [
    { label: "Playback", pages: ["playback", "appearance"] },
    { label: "Library", pages: ["sources"] },
    { label: "TV", pages: ["general", "display", "sound", "tv-appearance"] },
    { label: "Connections", pages: ["connection", "bluetooth"] },
    { label: "System", pages: ["updates", "advanced"] },
  ].map(group => ({
    ...group,
    pages: group.pages.filter(visible).map(id => [id, settingsPages[id as SettingsPage]] as const),
  }));

  return (
    <nav aria-label="Settings pages" className="hidden max-w-44 min-w-0 self-start lg:sticky lg:top-6 lg:grid lg:gap-1">
      {groups.map(group => (
        <div key={group.label} className="border-b border-border pb-1 last:border-0">
          <p aria-hidden="true" className="px-3 pt-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground first:pt-0">{group.label}</p>
          {group.pages.map(([id, page]) => (
            <Button key={id} variant="ghost" asChild className="h-auto min-h-11 w-full justify-between gap-3 p-3 text-left whitespace-normal aria-[current=page]:bg-muted aria-[current=page]:text-foreground">
              <Link aria-current={active === id || id === "sources" && sourcePage ? "page" : undefined} to={page.path}>
                <span>{page.label}</span>
                {active !== id && <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
              </Link>
            </Button>
          ))}
        </div>
      ))}
    </nav>
  );
}
