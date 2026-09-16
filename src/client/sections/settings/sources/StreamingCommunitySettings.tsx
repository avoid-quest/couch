import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/api/client";
import { validStreamingCommunityOrigin } from "../../../../shared/streamingcommunity";
import type { SourceCredentials } from "./sourceTypes";

type Props = { credentials: SourceCredentials | null; connected: boolean; canManage: boolean };
const empty: SourceCredentials = { origin: "", token: "" };

export function StreamingCommunitySettings({ credentials, connected, canManage }: Props) {
  const queryClient = useQueryClient();
  const [site, setSite] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const available = connected && canManage && !!credentials;
  const page = useQuery({
    queryKey: ["settings", "streaming-community"],
    enabled: available,
    queryFn: () => apiFetch(credentials ?? empty, "/api/settings/streamingcommunity").then(async response => {
      const value = await response.json() as { origin?: string; error?: string };
      if (!response.ok || !validStreamingCommunityOrigin(value.origin)) throw new Error(value.error || "Could not read the website origin.");
      return value.origin!;
    }),
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!credentials || !available || !page.data || pending) return;
    const nextOrigin = site.trim().replace(/\/$/, "");
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(credentials, "/api/settings/streamingcommunity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: nextOrigin }),
      });
      const value = await response.json() as { origin?: string; error?: string };
      if (!response.ok || !validStreamingCommunityOrigin(value.origin)) throw new Error(value.error || "Could not save the website origin.");
      await queryClient.invalidateQueries({ queryKey: ["settings", "streaming-community"] });
      setNotice("Website origin saved. Paste links from this website; saved links keep their original address.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the website origin.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="StreamingCommunity settings" className="space-y-3 border-t pt-4" data-tv-local-only>
      <h3 className="font-semibold">StreamingCommunity</h3>
      <p className="text-sm text-muted-foreground">Paste a film or episode link to play it on the TV. Browse and search are not available. If the website moves, an administrator can update its address here. Saved links keep their original address.</p>
      {canManage ? (
        <form className="space-y-3" onSubmit={event => void save(event)}>
          <Label htmlFor="streamingcommunity-origin">Current website origin</Label>
          <Input autoComplete="off" disabled={!available || page.isFetching || pending} id="streamingcommunity-origin" maxLength={254} onChange={event => setSite(event.target.value)} placeholder="https://streamingcommunityz.academy" spellCheck={false} type="url" value={site || page.data || ""} />
          <Button disabled={!available || page.isFetching || pending || !validStreamingCommunityOrigin(site.trim().replace(/\/$/, ""))}>{pending ? "Saving…" : "Save website origin"}</Button>
        </form>
      ) : <p className="text-sm text-muted-foreground">Use an administrator remote to update the website origin.</p>}
      {(page.error || error) && <p className="text-sm" role="alert">{error ?? "Could not read the website origin."}</p>}
      {notice && <p className="text-sm" role="status">{notice}</p>}
    </section>
  );
}
