import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FolderBrowse, ManagedFolder } from "../shared/folders";
import type { LibrarySource } from "../shared/library";

type FolderView = LibrarySource & Partial<Pick<ManagedFolder, "verified" | "scannedItems">>;
type Props = { credentials: { origin: string; token: string } | null; connected: boolean; canManage: boolean; version: number };
const labels: Record<LibrarySource["status"], string> = { idle: "Not scanned", scanning: "Scanning", ready: "Up to date", unavailable: "Unavailable", error: "Scan failed" };

export function FolderSettings({ credentials, connected, canManage, version }: Props) {
  const [sources, setSources] = useState<FolderView[]>([]);
  const [browser, setBrowser] = useState<FolderBrowse | null>(null);
  const [confirm, setConfirm] = useState<{ source: FolderView; action: "remove" | "verify" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const origin = credentials?.origin, token = credentials?.token;
  const canWrite = connected && canManage && !loading && !pending;

  useEffect(() => {
    setSources([]); setBrowser(null); setConfirm(null); setError(null); setNotice(null); setPending(null);
    return () => mutation.current?.abort();
  }, [origin, token, canManage]);

  useEffect(() => {
    if (!origin || !token || !connected) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void fetch(`${origin}/api/library/${canManage ? "folders" : "sources"}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not load TV folders.");
      if (!controller.signal.aborted) setSources(value.sources);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load TV folders."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, canManage, version]);

  async function browse(path: string | null = null, offset = 0) {
    if (!credentials || !canWrite) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending("browse"); setError(null); setNotice(null); setConfirm(null);
    try {
      const query = new URLSearchParams({ offset: String(offset), ...(path === null ? {} : { path }) });
      const response = await fetch(`${credentials.origin}/api/library/folders/browse?${query}`, {
        headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not open this TV folder.");
      if (!controller.signal.aborted) setBrowser(value);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not open this TV folder.");
    } finally {
      if (!controller.signal.aborted) setPending(null);
      if (mutation.current === controller) mutation.current = null;
    }
  }

  async function update(action: "add" | "scan" | "test" | "verify" | "remove", source?: FolderView) {
    if (!credentials || !canWrite || action === "add" && !browser?.path) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(action); setError(null); setNotice(null);
    try {
      const suffix = action === "add" ? "" : `/${encodeURIComponent(source!.id)}${action === "remove" ? "" : `/${action}`}`;
      const response = await fetch(`${credentials.origin}/api/library/sources${suffix}`, {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
        body: action === "add" ? JSON.stringify({ path: browser!.path }) : action === "verify" ? JSON.stringify({ confirmed: true }) : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not update this TV folder.");
      if (controller.signal.aborted) return;
      setSources(value.sources); setConfirm(null);
      if (action === "add") setBrowser(null);
      setNotice(action === "add" ? "Folder added. Start a scan to add its media to the library."
        : action === "scan" ? "Scan started. Its progress appears below."
        : action === "test" ? "Couch can read the original folder."
        : action === "verify" ? "Original folder verified. You can now scan it."
        : "Source removed from the catalog. Its media files, queue and watching history have been kept.");
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not update this TV folder.");
    } finally {
      if (!controller.signal.aborted) setPending(null);
      if (mutation.current === controller) mutation.current = null;
    }
  }

  return <section className="min-w-0 space-y-4" aria-label="TV folder settings" data-tv-local-only>
    <div className="space-y-1"><h3 className="text-base font-semibold">TV media folders</h3><p className="text-muted-foreground">These folders are on the TV computer, not your phone. Use local storage or a drive or network share that is already mounted on the TV.</p></div>
    {!canManage && <p className="text-muted-foreground">An administrator can manage folders in Sources. You can browse and play their media from Library.</p>}
    {loading && <p className="text-muted-foreground" role="status">Loading TV folders…</p>}
    {canManage && !browser && <Button className="min-h-11" disabled={!canWrite} onClick={() => void browse()}><Plus aria-hidden="true" />{pending === "browse" ? "Opening folders…" : "Add TV folder"}</Button>}
    {canManage && browser && <div className="min-w-0 space-y-3 rounded-lg border p-3" aria-label="TV folder browser">
      <div className="space-y-1"><p className="font-medium">Choose a folder on the TV</p><p className="break-all text-sm text-muted-foreground">{browser.path ?? "Permitted media locations"}</p></div>
      <div className="flex flex-wrap gap-2">
        {browser.path && <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void browse(browser.parent)}><ArrowLeft aria-hidden="true" />{browser.parent ? "Parent folder" : "Media locations"}</Button>}
        <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void browse(browser.path, browser.offset)}><RefreshCw aria-hidden="true" />Refresh</Button>
      </div>
      <ul className="space-y-2">{browser.locations.map(location => <li className="min-w-0 space-y-1" key={location.path}>
        <Button variant="outline" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" disabled={!canWrite || !!location.error} onClick={() => void browse(location.path)}><FolderOpen aria-hidden="true" className="shrink-0" /><span className="min-w-0 break-all">{location.name}</span></Button>
        {location.error && <p className="break-words text-sm text-destructive">{location.error}</p>}
      </li>)}</ul>
      {!browser.locations.length && <p className="text-sm text-muted-foreground">No subfolders here.</p>}
      {(browser.offset > 0 || browser.more) && <div className="flex flex-wrap gap-2" aria-label="Folder pages">
        <Button variant="outline" className="min-h-11" disabled={!canWrite || browser.offset === 0} onClick={() => void browse(browser.path, Math.max(0, browser.offset - 100))}>Previous folders</Button>
        <Button variant="outline" className="min-h-11" disabled={!canWrite || !browser.more} onClick={() => void browse(browser.path, browser.offset + 100)}>Next folders</Button>
      </div>}
      <div className="flex flex-wrap gap-2">
        {browser.path && !["/media", "/mnt"].includes(browser.path) && <Button className="min-h-11" disabled={!canWrite} onClick={() => void update("add")}>{pending === "add" ? "Testing folder…" : "Test and add this folder"}</Button>}
        <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => setBrowser(null)}>Cancel</Button>
      </div>
      <p className="text-sm text-muted-foreground">Couch uses these permitted locations. It does not mount network shares or move files. Add each mounted folder as its own source.</p>
    </div>}
    <ul className="space-y-3">{sources.map(source => <li key={source.id} data-folder-source={source.id}>
      <Card className="min-w-0 gap-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="min-w-0 break-all">{source.name}</strong><Badge variant={source.status === "error" || source.status === "unavailable" ? "destructive" : "secondary"}>{labels[source.status]}</Badge></div>
        {canManage && source.path && <p className="break-all text-sm text-muted-foreground">{source.path}</p>}
        <p className="text-sm text-muted-foreground" role={source.status === "scanning" ? "status" : undefined}>{source.status === "scanning" ? `${source.scannedItems ?? 0} media files checked` : `${source.itemCount} catalog items`}</p>
        {source.error && <p className="break-words text-sm text-destructive">{source.error}</p>}
        {source.warning && <p className="break-words text-sm text-muted-foreground">{source.warning}</p>}
        {canManage && <div className="flex flex-wrap gap-2">
          {source.verified === false ? <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => setConfirm({ source, action: "verify" })}>Verify original folder</Button> : <>
            <Button variant="outline" className="min-h-11" disabled={!canWrite || source.status === "scanning"} onClick={() => void update("test", source)}>Test access</Button>
            <Button variant="outline" className="min-h-11" disabled={!canWrite || source.status === "scanning"} onClick={() => void update("scan", source)}>{source.lastScanned ? "Scan again" : "Start scan"}</Button>
          </>}
          <Button variant="outline" className="min-h-11" disabled={!canWrite || source.status === "scanning"} onClick={() => setConfirm({ source, action: "remove" })}>Remove source</Button>
        </div>}
      </Card>
    </li>)}</ul>
    {canManage && confirm && <div className="space-y-3 rounded-lg border p-3" role="group" aria-label={confirm.action === "remove" ? "Confirm source removal" : "Verify original folder"}>
      <p className="break-words">{confirm.action === "remove"
        ? `Remove ${confirm.source.name} from the library catalog? Its media files and watching history stay. Current playback continues, but queued items from this source will be unavailable when played again.`
        : "This older source has no saved drive identity. Confirm that the path below is its original folder on the original drive before verifying it. Its catalog and watching history stay."}</p>
      {confirm.action === "verify" && <p className="break-all text-sm text-muted-foreground">{confirm.source.path}</p>}
      <div className="flex flex-wrap gap-2"><Button variant={confirm.action === "remove" ? "destructive" : "default"} className="min-h-11" disabled={!canWrite} onClick={() => void update(confirm.action, confirm.source)}>{confirm.action === "remove" ? "Remove source, keep files" : "Confirm original folder"}</Button><Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => setConfirm(null)}>Cancel</Button></div>
    </div>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p className="break-words text-sm text-primary" role="status">{notice}</p>}
    {!connected && <p className="text-muted-foreground" role="status">Connect this remote to the TV to use folder settings.</p>}
  </section>;
}
