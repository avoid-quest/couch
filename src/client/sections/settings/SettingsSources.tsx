import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { radioSourcesQuery } from "@/api/radio";
import { streamingCommunityQuery } from "@/api/settings";
import { iptvSourcesQuery } from "@/api/iptv";
import { avoidRadioPlaylistId } from "../../../shared/radio";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { IptvSettings } from "./sources/IptvSettings";
import { RadioSettings } from "./sources/RadioSettings";
import { StreamingCommunitySettings } from "./sources/StreamingCommunitySettings";
import { DeviceInputSettings } from "./sources/DeviceInputSettings";
import { useSessionGate } from "@/session/session-context";
import type { SourceKind, SourceSettingsProps } from "@/components/sourceTypes";

const sourcePages: SourceKind[] = ["device-inputs", "iptv", "radio", "streaming-community"];
const plural = (count: number, one: string) => `${count.toLocaleString()} ${one}${count === 1 ? "" : "s"}`;

export function SettingsSources({ source, onAdded, ...props }: SourceSettingsProps & { source?: SourceKind; onAdded?: () => void }) {
  if (source === "device-inputs") return <DeviceInputSettings onAdded={onAdded} />;
  if (source === "radio") return <RadioSettings {...props} />;
  if (source === "streaming-community") return <StreamingCommunitySettings {...props} />;
  if (source === "iptv") return <IptvSettings {...props} />;
  return <SourcesOverview {...props} />;
}

function SourcesOverview({ credentials, connected, canManage }: SourceSettingsProps) {
  const { state, localLiveSourceId } = useSessionGate();
  const available = connected && !!credentials;
  const empty = { origin: "", token: "" };
  const iptv = useQuery({ ...iptvSourcesQuery(credentials ?? empty), enabled: available });
  const radio = useQuery({ ...radioSourcesQuery(credentials ?? empty), enabled: available && canManage });
  const streaming = useQuery({ ...streamingCommunityQuery(credentials ?? empty), enabled: available && canManage });
  const radioSources = radio.data?.sources.filter(item => item.id !== avoidRadioPlaylistId);
  const queries = [iptv, ...(canManage ? [radio, streaming] : [])];
  const failed = queries.filter(query => query.isError);
  const status: Record<SourceKind, string | undefined> = {
    "device-inputs": state?.liveSources?.find(source => source.id === localLiveSourceId)?.name ?? "Screen, system audio or microphone",
    iptv: iptv.data && (iptv.data.sources.length ? `${plural(iptv.data.sources.length, "list")} · ${plural(iptv.data.sources.reduce((total, item) => total + item.channelCount, 0), "channel")}` : "Not set up"),
    radio: !canManage ? "Admin only" : radioSources && (radioSources.length ? plural(radioSources.length, "playlist") : "Built in only"),
    "streaming-community": !canManage ? "Admin only" : streaming.data?.origin,
  };

  return (
    <SettingsSection aria-label="Sources">
      {available && queries.some(query => query.isPending) && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>}
      {sourcePages.map(id => (
        <SettingsRow key={id} label={settingsPages[`source-${id}` as SettingsPage].label} description={status[id]}>
          <Button variant="ghost" asChild><Link to={settingsPages[`source-${id}` as SettingsPage].path} aria-label={`Open ${settingsPages[`source-${id}` as SettingsPage].label}`}>Open<ChevronRight aria-hidden="true" /></Link></Button>
        </SettingsRow>
      ))}
      {failed.length > 0 && <Alert variant="destructive"><AlertDescription>Couldn't load sources.</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={!available} onClick={() => failed.forEach(query => void query.refetch())}>Try again</Button></AlertAction></Alert>}
    </SettingsSection>
  );
}
