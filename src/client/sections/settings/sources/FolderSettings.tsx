import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/api/client";
import type { ManagedFolder } from "../../../../shared/folders";
import type { LibrarySource } from "../../../../shared/library";
import { FolderBrowser } from "./FolderBrowser";
import type { SourceCredentials } from "@/components/sourceTypes";

type FolderView = LibrarySource & Partial<Pick<ManagedFolder, "verified" | "scannedItems">>;
type Props = { credentials: SourceCredentials | null; connected: boolean; canManage: boolean };
type FolderPage = { sources: FolderView[] };
type FolderAction = "add" | "scan" | "test" | "verify" | "remove";
const labels: Record<LibrarySource["status"], string> = { idle: "Not scanned", scanning: "Scanning", ready: "Up to date", unavailable: "Unavailable", error: "Scan failed" };
const empty: SourceCredentials = { origin: "", token: "" };

export function FolderSettings({ credentials, connected, canManage }: Props) {
  const queryClient = useQueryClient();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ source: FolderView; action: "remove" | "verify" } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const available = connected && !!credentials;
  const canWrite = available && canManage && !pending;
  const page = useQuery({
    queryKey: ["library", "settings-folders", canManage],
    enabled: available,
    queryFn: () => apiFetch(credentials ?? empty, `/api/library/${canManage ? "folders" : "sources"}`).then(response => response.json() as Promise<FolderPage>),
  });
  const sources = page.data?.sources ?? [];
  const queryError = page.error instanceof Error ? page.error.message : page.error ? "Could not load TV folders." : null;

  async function update(action: FolderAction, source?: FolderView, path?: string) {
    if (!credentials || !canWrite || action === "add" && !path) return;
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const suffix = action === "add" ? "" : `/${encodeURIComponent(source!.id)}${action === "remove" ? "" : `/${action}`}`;
      await apiFetch(credentials, `/api/library/sources${suffix}`, {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "add" ? JSON.stringify({ path }) : action === "verify" ? JSON.stringify({ confirmed: true }) : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["library"] });
      setConfirm(null);
      setBrowserOpen(false);
      setNotice(action === "add" ? "Folder added. Start a scan to add its media to the library."
        : action === "scan" ? "Scan started. Its progress appears below."
        : action === "test" ? "Couch can read the original folder."
        : action === "verify" ? "Original folder verified. You can now scan it."
        : "Source removed from the catalog. Its media files, queue and watching history have been kept.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this TV folder.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="TV folder settings" className="min-w-0 space-y-4" data-tv-local-only>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">TV media folders</h3>
        <p className="text-muted-foreground">These folders are on the TV computer, not your phone. Use local storage or a drive or network share that is already mounted on the TV.</p>
      </div>
      {!canManage && <p className="text-muted-foreground">An administrator can manage folders in Sources. You can browse and play their media from Library.</p>}
      {(page.isFetching || pending === "browse") && <p className="text-muted-foreground" role="status">Loading TV folders…</p>}
      {canManage && !browserOpen && <Button className="min-h-11" disabled={!canWrite} onClick={() => setBrowserOpen(true)}>Add TV folder</Button>}
      {canManage && browserOpen && credentials && <FolderBrowser canWrite={canWrite} credentials={credentials} onAdd={path => void update("add", undefined, path)} />}
      <ul className="space-y-3">
        {sources.map(source => (
          <li data-folder-source={source.id} key={source.id}>
            <div className="min-w-0 space-y-3 border-t border-border py-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong className="min-w-0 break-all">{source.name}</strong><Badge variant={source.status === "error" || source.status === "unavailable" ? "destructive" : "secondary"}>{labels[source.status]}</Badge></div>
              {canManage && source.path && <p className="break-all text-sm text-muted-foreground">{source.path}</p>}
              <p className="text-sm text-muted-foreground" role={source.status === "scanning" ? "status" : undefined}>{source.status === "scanning" ? `${source.scannedItems ?? 0} media files checked` : `${source.itemCount} catalog items`}</p>
              {source.error && <p className="break-words text-sm text-destructive">{source.error}</p>}
              {source.warning && <p className="break-words text-sm text-muted-foreground">{source.warning}</p>}
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {source.verified === false ? <Button className="min-h-11" disabled={!canWrite} onClick={() => setConfirm({ source, action: "verify" })} variant="outline">Verify original folder</Button> : <>
                    <Button className="min-h-11" disabled={!canWrite || source.status === "scanning"} onClick={() => void update("test", source)} variant="outline">Test access</Button>
                    <Button className="min-h-11" disabled={!canWrite || source.status === "scanning"} onClick={() => void update("scan", source)} variant="outline">{source.lastScanned ? "Scan again" : "Start scan"}</Button>
                  </>}
                  <Button className="min-h-11" disabled={!canWrite || source.status === "scanning"} onClick={() => setConfirm({ source, action: "remove" })} variant="outline">Remove source</Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canManage && confirm && (
        <div aria-label={confirm.action === "remove" ? "Confirm source removal" : "Verify original folder"} className="space-y-3 border-t border-border py-4" role="group">
          <p className="break-words">{confirm.action === "remove"
            ? `Remove ${confirm.source.name} from the library catalog? Its media files and watching history stay. Current playback continues, but queued items from this source will be unavailable when played again.`
            : "This older source has no saved drive identity. Confirm that the path below is its original folder on the original drive before verifying it. Its catalog and watching history stay."}</p>
          {confirm.action === "verify" && <p className="break-all text-sm text-muted-foreground">{confirm.source.path}</p>}
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={!canWrite} onClick={() => void update(confirm.action, confirm.source)} variant={confirm.action === "remove" ? "destructive" : "default"}>{confirm.action === "remove" ? "Remove source, keep files" : "Confirm original folder"}</Button>
            <Button className="min-h-11" onClick={() => setConfirm(null)} variant="outline">Cancel</Button>
          </div>
        </div>
      )}
      {(queryError || error) && <Alert variant="destructive"><AlertDescription>{queryError ?? error}</AlertDescription></Alert>}
      {notice && <p className="break-words text-sm text-primary" role="status">{notice}</p>}
      {!connected && <p className="text-muted-foreground" role="status">Connect this remote to the TV to use folder settings.</p>}
    </section>
  );
}
