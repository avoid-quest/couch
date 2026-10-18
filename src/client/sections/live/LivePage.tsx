import { useQuery } from "@tanstack/react-query";
import { iptvSourcesQuery } from "@/api/iptv";
import { BrowseRadio } from "@/sections/find/BrowseRadio";
import { BrowseLiveTv } from "@/sections/find/BrowseLiveTv";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

// Live: the stations, then the channels once a Live TV source has some.
export function LivePage() {
  const { credentials, available, section } = useShell();
  const { connected, run } = useSessionGate();
  const iptv = useQuery({ ...iptvSourcesQuery(credentials), enabled: connected });
  return <section data-page="Live" className="space-y-12">
    <BrowseRadio origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={section === "Live"} onCommand={run} />
    {iptv.data?.sources.some(source => source.channelCount) && <BrowseLiveTv />}
  </section>;
}
