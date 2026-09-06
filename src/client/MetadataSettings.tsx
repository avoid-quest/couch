import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import tmdbLogo from "./tmdb-logo.svg";

export function MetadataSettings({ credentials, connected, canManage, version }: { credentials: { origin: string; token: string } | null; connected: boolean; canManage: boolean; version: number }) {
  const [configured, setConfigured] = useState(false), [token, setToken] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const origin = credentials?.origin, credential = credentials?.token;
  useEffect(() => {
    operation.current?.abort(); setToken(""); setError(null); setNotice(null); setPending(false);
    return () => operation.current?.abort();
  }, [origin, credential, connected, canManage]);
  useEffect(() => {
    setConfigured(false); setError(null);
    if (!origin || !credential || !connected || !canManage) return;
    const controller = new AbortController();
    void fetch(`${origin}/api/metadata/provider`, { headers: { Authorization: `Bearer ${credential}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not read metadata setup."); if (!controller.signal.aborted) setConfigured(value.configured); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not read metadata setup."); });
    return () => controller.abort();
  }, [origin, credential, connected, canManage, version]);
  async function save(event: FormEvent, clear = false) {
    event.preventDefault();
    if (!credentials || !connected || !canManage || pending) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller; setPending(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${credentials.origin}/api/metadata/provider`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ token: clear ? "" : token }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not save metadata setup.");
      if (!controller.signal.aborted) { setConfigured(value.configured); setToken(""); setNotice(clear ? "TMDB token cleared. Saved metadata remains available." : "TMDB token saved on the TV. Use a video's metadata editor to search and preview a match."); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not save metadata setup."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  return <section className="space-y-3 border-t pt-4" aria-label="TMDB metadata settings" data-tv-local-only>
    <h3 className="font-semibold">Movie and episode metadata</h3><p className="text-sm text-muted-foreground">Manual corrections and exports work offline. TMDB search requires your authorized API Read Access Token. The saved token stays on the TV and is never returned to remotes.</p>
    {canManage ? <form className="space-y-3" onSubmit={event => void save(event)}><p role="status" className="text-sm">{configured ? "TMDB token configured" : "TMDB is not configured"}</p><Label htmlFor="metadata-token">TMDB API Read Access Token</Label><Input id="metadata-token" className="min-h-11" type="password" autoComplete="new-password" spellCheck={false} value={token} maxLength={2048} disabled={!connected || pending} onChange={event => setToken(event.target.value)} /><div className="flex flex-wrap gap-2"><Button className="min-h-11" type="submit" disabled={!connected || pending || !token}>Save TMDB token</Button>{configured && <Button className="min-h-11" type="button" variant="outline" disabled={!connected || pending} onClick={event => void save(event, true)}>Clear TMDB token</Button>}</div></form> : <p className="text-sm">Use an administrator remote to configure TMDB.</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{notice && <p role="status" className="text-sm">{notice}</p>}
    <div aria-label="TMDB credits" className="space-y-2 text-xs text-muted-foreground"><a className="inline-block min-h-11 content-center" href="https://www.themoviedb.org" target="_blank" rel="noreferrer"><img src={tmdbLogo} alt="TMDB" className="w-24" /></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div>
  </section>;
}
