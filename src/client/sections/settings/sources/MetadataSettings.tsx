import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/api/client";
import tmdbLogo from "../../../tmdb-logo.svg";
import type { SourceCredentials } from "@/components/sourceTypes";

type Props = { credentials: SourceCredentials | null; connected: boolean; canManage: boolean };
const empty: SourceCredentials = { origin: "", token: "" };

export function MetadataSettings({ credentials, connected, canManage }: Props) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const available = connected && canManage && !!credentials;
  const page = useQuery({
    queryKey: ["metadata", "provider"],
    enabled: available,
    queryFn: () => apiFetch(credentials ?? empty, "/api/metadata/provider").then(response => response.json() as Promise<{ configured: boolean }>),
  });

  async function save(event: FormEvent, clear = false) {
    event.preventDefault();
    if (!credentials || !available || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const value = await apiFetch(credentials, "/api/metadata/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: clear ? "" : token }),
      }).then(response => response.json() as Promise<{ configured: boolean; error?: string }>);
      if (typeof value.configured !== "boolean") throw new Error(value.error || "Could not save metadata setup.");
      await queryClient.invalidateQueries({ queryKey: ["metadata", "provider"] });
      setToken("");
      setNotice(clear ? "TMDB token cleared. Saved metadata remains available." : "TMDB token saved on the TV. Use a video's metadata editor to search and preview a match.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save metadata setup.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="TMDB metadata settings" className="space-y-3 border-t pt-4" data-tv-local-only>
      <h3 className="font-semibold">Movie and episode metadata</h3>
      <p className="text-sm text-muted-foreground">Manual corrections and exports work offline. TMDB search requires your authorized API Read Access Token. The saved token stays on the TV and is never returned to remotes.</p>
      {canManage ? (
        <form className="space-y-3" onSubmit={event => void save(event)}>
          <p className="text-sm" role="status">{page.isFetching ? "Checking TMDB setup…" : page.data?.configured ? "TMDB token configured" : "TMDB is not configured"}</p>
          <Label htmlFor="metadata-token">TMDB API Read Access Token</Label>
          <Input autoComplete="new-password" className="min-h-11" disabled={!available || pending} id="metadata-token" maxLength={2048} onChange={event => setToken(event.target.value)} spellCheck={false} type="password" value={token} />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={!available || pending || !token} type="submit">Save TMDB token</Button>
            {page.data?.configured && <Button className="min-h-11" disabled={!available || pending} onClick={event => void save(event, true)} type="button" variant="outline">Clear TMDB token</Button>}
          </div>
        </form>
      ) : <p className="text-sm">Use an administrator remote to configure TMDB.</p>}
      {(page.error || error) && <Alert variant="destructive"><AlertDescription>{error ?? "Could not read metadata setup."}</AlertDescription></Alert>}
      {notice && <p className="text-sm" role="status">{notice}</p>}
      <div aria-label="TMDB credits" className="space-y-2 text-xs text-muted-foreground">
        <a className="inline-block min-h-11 content-center" href="https://www.themoviedb.org" rel="noreferrer" target="_blank"><img alt="TMDB" className="w-24" src={tmdbLogo} /></a>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
    </section>
  );
}
