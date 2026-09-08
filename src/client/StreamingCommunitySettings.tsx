import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validStreamingCommunityOrigin } from "../shared/streamingcommunity";

export function StreamingCommunitySettings({ credentials, connected, canManage }: { credentials: { origin: string; token: string } | null; connected: boolean; canManage: boolean }) {
  const [site, setSite] = useState(""), [pending, setPending] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const origin = credentials?.origin, token = credentials?.token;
  useEffect(() => {
    operation.current?.abort(); setSite(""); setLoaded(false); setPending(false); setError(null); setNotice(null);
    if (!origin || !token || !connected || !canManage) return;
    const controller = new AbortController(); operation.current = controller;
    void fetch(`${origin}/api/settings/streamingcommunity`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => { const value = await response.json(); if (!response.ok || !validStreamingCommunityOrigin(value.origin)) throw new Error(value.error || "Could not read the website origin."); if (!controller.signal.aborted) { setSite(value.origin); setLoaded(true); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not read the website origin."); });
    return () => operation.current?.abort();
  }, [origin, token, connected, canManage]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!origin || !token || !connected || !canManage || !loaded || pending) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller; setPending(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${origin}/api/settings/streamingcommunity`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ origin: site.trim().replace(/\/$/, "") }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const value = await response.json(); if (!response.ok || !validStreamingCommunityOrigin(value.origin)) throw new Error(value.error || "Could not save the website origin.");
      if (!controller.signal.aborted) { setSite(value.origin); setNotice("Website origin saved. Paste links from this website; saved links keep their original address."); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not save the website origin."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  return <section className="space-y-3 border-t pt-4" aria-label="StreamingCommunity settings" data-tv-local-only>
    <h3 className="font-semibold">StreamingCommunity</h3><p className="text-sm text-muted-foreground">Paste a film or episode link to play it on the TV. Browse and search are not available. If the website moves, an administrator can update its address here. Saved links keep their original address.</p>
    {canManage ? <form className="space-y-3" onSubmit={event => void save(event)}><Label htmlFor="streamingcommunity-origin">Current website origin</Label><Input id="streamingcommunity-origin" type="url" placeholder="https://streamingcommunityz.taxi" value={site} onChange={event => setSite(event.target.value)} maxLength={254} autoComplete="off" spellCheck={false} disabled={!connected || !loaded || pending} /><Button type="submit" disabled={!connected || !loaded || pending || !validStreamingCommunityOrigin(site.trim().replace(/\/$/, ""))}>{pending ? "Saving…" : "Save website origin"}</Button></form> : <p className="text-sm text-muted-foreground">Use an administrator remote to update the website origin.</p>}
    {error && <p role="alert" className="text-sm">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
