import { Spinner } from "@/components/ui/spinner";
import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { GuideSources, type GuideRequest } from "@/components/GuideSources";
import { TRY_AGAIN } from "@/copy";
import { iptvRequest, iptvSourcesQuery } from "@/api/iptv";
import type { SourceSettingsProps } from "@/components/sourceTypes";

export function IptvSettings({ credentials, connected, canManage }: SourceSettingsProps) {
  const queryClient = useQueryClient();
  const page = useQuery({ ...iptvSourcesQuery(credentials ?? { origin: "", token: "" }), enabled: !!credentials && connected && canManage });
  const cancellation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    cancellation.current = controller;
    return () => controller.abort();
  }, [credentials, connected, canManage]);
  const request = useCallback<GuideRequest>(async (path, init = {}) => {
    if (!credentials) throw new Error("Couldn't update Live TV.");
    const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), ...(cancellation.current ? [cancellation.current.signal] : [])]);
    const response = await iptvRequest(credentials, path, { ...init, signal });
    if (init.method) await queryClient.invalidateQueries({ queryKey: ["iptv"] });
    return response;
  }, [credentials, queryClient]);

  return (
    <div className="flex min-w-0 flex-col gap-8" data-tv-local-only>
      {page.error && <Alert variant="destructive"><AlertDescription>Couldn't load Live TV sources.</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={!connected} onClick={() => void page.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
      {credentials && connected && canManage && page.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>}
      {credentials && (!canManage || page.data) && <GuideSources connected={connected && canManage} host={false} inline request={request} sources={page.data?.sources ?? []} />}
    </div>
  );
}
