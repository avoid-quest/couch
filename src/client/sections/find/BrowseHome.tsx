import { MediaList, MediaRow } from "@/components/MediaRow";

// Find with an empty query: what Couch searches and where to browse. What to
// continue and what was saved for later live on Home.
export function BrowseHome({ onBrowse }: { onBrowse?: (source: "radio") => void }) {
  return <div className="space-y-6">
    {onBrowse && <section aria-label="Browse">
      <h2 className="mb-2 text-base font-medium">Browse</h2>
      <MediaList>
        <MediaRow title="Radio" meta="Stations and playlists" primary={{ label: "Open", onClick: () => onBrowse("radio") }} />
      </MediaList>
    </section>}
    <p className="max-w-prose text-sm text-muted-foreground">Couch searches YouTube, Twitch, RaiPlay and radio at once. You can also paste a link.</p>
  </div>;
}
