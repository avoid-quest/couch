import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiSend } from "@/api/client";
import { streamingCommunityQuery } from "@/api/settings";
import { streamingCommunityOrigin, validStreamingCommunityOrigin } from "../../../../shared/streamingcommunity";
import type { SourceCredentials } from "@/components/sourceTypes";

type Props = { credentials: SourceCredentials | null; connected: boolean; canManage: boolean };
const empty: SourceCredentials = { origin: "", token: "" };

export function StreamingCommunitySettings({ credentials, connected, canManage }: Props) {
  const queryClient = useQueryClient();
  const [site, setSite] = useState("");
  const available = connected && canManage && !!credentials;
  const page = useQuery({ ...streamingCommunityQuery(credentials ?? empty), enabled: available });
  const saving = useMutation({
    mutationFn: (origin: string) => apiSend<{ origin: string }>(credentials!, "/api/settings/streamingcommunity", { origin }),
    onSuccess: value => queryClient.setQueryData(streamingCommunityQuery(credentials!).queryKey, value),
  });
  const pending = saving.isPending;
  const error = saving.error ? saving.error.message || "Could not save the website origin." : null;
  const notice = saving.isSuccess ? "Website origin saved. Paste links from this website; saved links keep their original address." : null;

  function save(event: FormEvent) {
    event.preventDefault();
    if (credentials && available && page.data && !pending) saving.mutate(site.trim().replace(/\/$/, ""));
  }

  return (
    <section aria-label="StreamingCommunity settings" className="space-y-3 border-t pt-4" data-tv-local-only>
      <h3 className="font-semibold">StreamingCommunity</h3>
      <p className="text-sm text-muted-foreground">Browse and search StreamingCommunity in Find, or paste a film or episode link to play it on the TV. If the website moves, an administrator can update its address here. Saved links keep their original address.</p>
      {canManage ? (
        <form className="space-y-3" onSubmit={save}>
          <Label htmlFor="streamingcommunity-origin">Current website origin</Label>
          <Input autoComplete="off" disabled={!available || page.isFetching || pending} id="streamingcommunity-origin" maxLength={254} onChange={event => setSite(event.target.value)} placeholder={streamingCommunityOrigin} spellCheck={false} type="url" value={site || page.data?.origin || ""} />
          <Button disabled={!available || page.isFetching || pending || !validStreamingCommunityOrigin(site.trim().replace(/\/$/, ""))}>{pending ? "Saving…" : "Save website origin"}</Button>
        </form>
      ) : <p className="text-sm text-muted-foreground">Use an administrator remote to update the website origin.</p>}
      {(page.error || error) && <p className="text-sm" role="alert">{error ?? "Could not read the website origin."}</p>}
      {notice && <p className="text-sm" role="status">{notice}</p>}
    </section>
  );
}
