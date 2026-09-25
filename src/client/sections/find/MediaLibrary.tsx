import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { ProviderPanel } from "@/components/ProviderPanel";

export function MediaLibrary({ onBrowse, ...props }: Omit<ComponentProps<typeof ProviderPanel>, "version"> & { onBrowse: (section: string) => void }) {
  return <section className="min-w-0 space-y-5" aria-label="Library">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
      <nav className="flex flex-wrap gap-2" aria-label="More library sources" data-nav-row>
        {([["Radio", "Radio"], ["Guide", "Live TV"], ["Jellyfin", "Jellyfin"], ["Files", "TV folders"]] as const).map(([section, label]) => <Button key={section} variant="outline" className="min-h-11" onClick={() => onBrowse(section)}>{label}</Button>)}
      </nav>
    </header>
    <ProviderPanel {...props} version={0} showHeading={false} />
  </section>;
}
