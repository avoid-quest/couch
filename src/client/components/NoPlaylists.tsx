import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useSettingsScope } from "@/sections/settings/settings-scope";

/**
 * A list that stays empty until an admin adds a playlist (Live TV, Radio's playlists): an admin gets the way there,
 * anyone else one plain line.
 */
export function NoPlaylists({ what, settings }: { what: string; settings: "/settings/couch/sources/live-tv" | "/settings/couch/sources/radio" }) {
  const { administrator } = useSettingsScope();
  if (!administrator) return <p role="status" className="text-sm text-muted-foreground">No {what} yet. An admin can add a playlist.</p>;
  return <Empty className="py-0">
    <EmptyHeader><EmptyTitle>No {what} yet</EmptyTitle></EmptyHeader>
    <EmptyContent><Button data-page-first asChild><Link to={settings}>Add a playlist</Link></Button></EmptyContent>
  </Empty>;
}
