import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GuideSources, type GuideRequest } from "./GuideSources";
import type { GuideSource } from "../shared/iptv";
import { StreamingCommunitySettings } from "./StreamingCommunitySettings";
import { MetadataSettings } from "./MetadataSettings";
import { FolderSettings } from "./FolderSettings";
import { JellyfinSettings } from "./JellyfinSettings";
import { RadioSettings } from "./RadioSettings";

export function SettingsSources({ radioVersion, libraryVersion, iptvVersion, controllerVersion, setupOnly = false, source, ...props }: React.ComponentProps<typeof JellyfinSettings> & { radioVersion: number; libraryVersion: number; iptvVersion?: number; controllerVersion?: number; setupOnly?: boolean; source?: string }) {
  if (source === "iptv") return <IptvSettings {...props} version={iptvVersion ?? props.version} controllerVersion={controllerVersion} />;
  if (source === "folders") return <FolderSettings {...props} version={libraryVersion} />;
  if (source === "jellyfin") return <JellyfinSettings {...props} />;
  if (source === "radio") return <RadioSettings {...props} version={radioVersion} />;
  if (source === "metadata") return <MetadataSettings {...props} version={libraryVersion} />;
  if (source === "streaming-community") return <StreamingCommunitySettings {...props} />;
  return <div className="space-y-6"><FolderSettings {...props} version={libraryVersion} /><JellyfinSettings {...props} />{!setupOnly && <><RadioSettings {...props} version={radioVersion} /><MetadataSettings {...props} version={libraryVersion} /><StreamingCommunitySettings {...props} /></>}</div>;
}

function IptvSettings({ credentials, connected, canManage, version, controllerVersion }: React.ComponentProps<typeof JellyfinSettings> & { controllerVersion?: number }) {
  const origin = credentials?.origin ?? "", token = credentials?.token ?? "";
  const [sources, setSources] = useState<GuideSource[]>([]);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const request = useCallback<GuideRequest>(async (path, init = {}) => {
    const response = await fetch(`${origin}/api/iptv/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(25_000)]) });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Could not load IPTV sources."); }
    if (init.method) setRefresh(value => value + 1);
    return response;
  }, [origin, token]);
  useEffect(() => {
    setSources([]); setError("");
    if (!credentials || !connected || !canManage) return;
    const controller = new AbortController();
    void request("sources", { signal: controller.signal }).then(response => response.json()).then(body => { if (!controller.signal.aborted) setSources(body.sources); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load IPTV sources."); });
    return () => controller.abort();
  }, [request, connected, canManage, version, refresh]);
  return <>{error && <p role="alert">{error} <Button variant="outline" disabled={!connected} onClick={() => setRefresh(value => value + 1)}>Retry IPTV sources</Button></p>}<GuideSources inline request={request} sources={sources} host={false} connected={connected && canManage} controllerVersion={controllerVersion ?? version} origin={origin} token={token} /></>;
}
