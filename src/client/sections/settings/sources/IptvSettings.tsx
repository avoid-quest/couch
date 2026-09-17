import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GuideSources, type GuideRequest } from "@/components/GuideSources";
import { iptvSourcesQuery } from "@/api/iptv";
import { apiFetch } from "@/api/client";
import type { SourceSettingsProps } from "@/components/sourceTypes";

export function IptvSettings({ credentials, connected, canManage }: SourceSettingsProps) {
  const queryClient = useQueryClient();
  const page = useQuery({ ...iptvSourcesQuery(credentials ?? { origin: "", token: "" }), enabled: !!credentials && connected && canManage });
  const request = useCallback<GuideRequest>(async (path, init = {}) => {
    if (!credentials) throw new Error("Could not update IPTV sources.");
    try {
      const response = await apiFetch(credentials, `/api/iptv/${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
      if (init.method) await queryClient.invalidateQueries({ queryKey: ["iptv"] });
      return response;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Could not update IPTV sources.");
    }
  }, [credentials, queryClient]);

  return (
    <>
      {page.error && (
        <p role="alert">
          {page.error instanceof Error ? page.error.message : "Could not load IPTV sources."}
          <Button className="ml-2" disabled={!connected || !canManage} onClick={() => void page.refetch()} variant="outline">Retry IPTV sources</Button>
        </p>
      )}
      {credentials && <GuideSources connected={connected && canManage} controllerVersion={0} host={false} inline origin={credentials.origin} request={request} sources={page.data?.sources ?? []} token={credentials.token} />}
    </>
  );
}
