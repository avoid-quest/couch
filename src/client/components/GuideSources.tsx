import { useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import type { ControllerIdentity } from "../../shared/controllers";
import type { GuideSource } from "../../shared/iptv";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type GuideRequest = (path: string, init?: RequestInit) => Promise<Response>;
type Props = { inline?: boolean; request: GuideRequest; sources: GuideSource[]; host: boolean; connected: boolean; controllerVersion: number; origin: string; token: string };

export function GuideSources({ inline = false, request, sources, host, connected, controllerVersion, origin, token }: Props) {
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState<ControllerIdentity | null>(null);
  const [editing, setEditing] = useState<GuideSource | null>(null);
  const [name, setName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [guideUrl, setGuideUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const administrator = identity?.authority === "host" || identity?.authority === "administrator";
  useEffect(() => {
    setIdentity(null);
    if (!connected) return;
    const controller = new AbortController();
    void fetch(`${origin}/api/controllers/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then(async response => { const value = await response.json() as ControllerIdentity; if (response.ok && !controller.signal.aborted) setIdentity(value); }).catch(() => {});
    return () => controller.abort();
  }, [origin, token, connected, controllerVersion]);
  useEffect(() => { if (!open && !inline || !administrator) { setPlaylistUrl(""); setGuideUrl(""); } }, [open, inline, administrator]);

  async function mutate(path: string, method: string, value?: unknown) {
    setBusy(true); setError(null); setNotice("");
    try {
      await request(path, { method, body: value === undefined ? undefined : JSON.stringify(value) });
      setNotice(method === "DELETE" ? "Source removed." : "Guide saved on the TV.");
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this source."); return false; }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await mutate(editing ? `sources/${editing.id}` : "sources", "POST", { name, playlistUrl, guideUrl })) { setEditing(null); setName(""); setPlaylistUrl(""); setGuideUrl(""); }
  }
  const edit = (source: GuideSource | null) => { setEditing(source); setName(source?.name ?? ""); setPlaylistUrl(""); setGuideUrl(""); setError(null); };
  if (!administrator) return <p className="text-sm text-muted-foreground">An administrator can add or refresh guide sources.</p>;
  const content = <>
      {error && <p role="alert" className="border-l-2 border-destructive py-2 pl-3 text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
      <ul className="divide-y">{sources.map(source => <li className="space-y-2 py-3" key={source.id}>
        <p className="break-words font-medium">{source.name}</p>
        <p className="text-sm text-muted-foreground">{source.channelCount} channels · {source.programCount} programs<br />{source.updatedAt ? `Updated ${new Date(source.updatedAt).toLocaleString()}` : "No cached guide"}</p>
        {source.error && <p className="text-sm text-destructive">{source.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!connected || busy} onClick={() => void mutate(`sources/${source.id}/refresh`, "POST")}><RefreshCw aria-hidden="true" />Refresh</Button>
          <Button variant="outline" disabled={!connected || busy} onClick={() => edit(source)}>Replace URLs</Button>
          <Button variant="ghost" aria-label={`Remove ${source.name}`} disabled={!connected || busy} onClick={() => void mutate(`sources/${source.id}`, "DELETE")}><Trash2 aria-hidden="true" />Remove</Button>
        </div>
      </li>)}</ul>
      <form className="space-y-3 border-t pt-4" onSubmit={event => void save(event)}>
        <h3 className="font-medium">{editing ? `Replace ${editing.name}` : "Add source"}</h3>
        <div className="space-y-2"><Label htmlFor="guide-source-name">Source name</Label><Input id="guide-source-name" value={name} maxLength={100} required disabled={busy || !connected} onChange={event => setName(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="guide-playlist-url">M3U URL</Label><Input id="guide-playlist-url" type="password" autoComplete="off" inputMode="url" spellCheck={false} autoCapitalize="none" value={playlistUrl} maxLength={4096} required disabled={busy || !connected} onChange={event => setPlaylistUrl(event.target.value)} placeholder="https://…" /></div>
        <div className="space-y-2"><Label htmlFor="guide-xmltv-url">XMLTV URL</Label><Input id="guide-xmltv-url" type="password" autoComplete="off" inputMode="url" spellCheck={false} autoCapitalize="none" value={guideUrl} maxLength={4096} required disabled={busy || !connected} onChange={event => setGuideUrl(event.target.value)} placeholder="https://…" /></div>
        <p className="text-sm text-muted-foreground">URLs stay on the TV. Enter both URLs when replacing a source. Each channel needs a unique tvg-id matching the XMLTV channel id. Limits: 2 MiB M3U, 16 MiB XMLTV, 5,000 channels and 100,000 programs per source.</p>
        <p className="text-sm text-muted-foreground">Use minute-precision program times with numeric timezone offsets or UTC. Custom playback headers, DRM and catch-up are unavailable.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !connected}><Plus aria-hidden="true" />{busy ? "Loading guide…" : editing ? "Replace source" : "Import guide"}</Button>{editing && <Button type="button" variant="outline" disabled={busy} onClick={() => edit(null)}>Cancel replacement</Button>}</div>
      </form>
  </>;
  if (inline) return <section className="space-y-4" aria-label="IPTV sources"><h3 className="text-lg font-medium">IPTV</h3><p className="text-sm text-muted-foreground">Add an M3U channel list and its XMLTV guide.</p>{content}</section>;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" data-tv-local-only={host || undefined}><Settings2 aria-hidden="true" />Guide sources</Button></DialogTrigger>
    <DialogContent className="guide-sources" data-tv-local-only={host || undefined}>
      <DialogHeader><DialogTitle>Guide sources</DialogTitle><DialogDescription>Add a supported M3U channel list and its XMLTV guide. Use feeds you are allowed to watch.</DialogDescription></DialogHeader>
      {content}
    </DialogContent>
  </Dialog>;
}
