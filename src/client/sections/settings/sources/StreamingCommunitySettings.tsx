import { Spinner } from "@/components/ui/spinner";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_ONLY } from "@/copy";
import { apiSend } from "@/api/client";
import { streamingCommunityQuery } from "@/api/settings";
import { streamingCommunityOrigin, validStreamingCommunityOrigin } from "../../../../shared/streamingcommunity";
import type { SourceCredentials, SourceSettingsProps } from "@/components/sourceTypes";

const empty: SourceCredentials = { origin: "", token: "" };

export function StreamingCommunitySettings({ credentials, connected, canManage }: SourceSettingsProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const available = connected && canManage && !!credentials;
  const page = useQuery({ ...streamingCommunityQuery(credentials ?? empty), enabled: available });
  const site = draft ?? page.data?.origin ?? "";
  const saving = useMutation({
    mutationFn: (origin: string) => apiSend<{ origin: string }>(credentials!, "/api/settings/streamingcommunity", { origin }),
    onSuccess: value => { queryClient.setQueryData(streamingCommunityQuery(credentials!).queryKey, value); setDraft(null); },
  });
  const pending = saving.isPending;
  const value = site.trim().replace(/\/$/, "");
  const error = saving.error ? saving.error.message || "Couldn't save the site address." : page.error ? "Couldn't read the site address." : null;

  function save(event: FormEvent) {
    event.preventDefault();
    if (credentials && available && page.data && !pending) saving.mutate(value);
  }

  return (
    <SettingsSection aria-label="StreamingCommunity settings" description="Couch follows the site when it moves. An address saved here is used while it works." data-tv-local-only>
      {available && page.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>}
      {canManage ? <SettingsRow label="Site address" htmlFor="streamingcommunity-origin">
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={save}>
          <Input autoComplete="off" className="min-w-0 flex-1" disabled={!available || page.isFetching || pending} id="streamingcommunity-origin" maxLength={254} onChange={event => setDraft(event.target.value)} placeholder={streamingCommunityOrigin} spellCheck={false} type="url" value={site} />
          <Button type="submit" variant="outline" disabled={!available || page.isFetching || pending || value === page.data?.origin || !validStreamingCommunityOrigin(value)}>{pending ? "Saving…" : "Save"}</Button>
        </form>
      </SettingsRow> : <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription>{page.error && !saving.error && <AlertAction><Button variant="outline" size="sm" disabled={!available} onClick={() => void page.refetch()}>Try again</Button></AlertAction>}</Alert>}
    </SettingsSection>
  );
}
