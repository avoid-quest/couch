import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ADMIN_ONLY, deviceName } from "@/copy";
import { apiFetch } from "@/api/client";
import { libraryFoldersQuery } from "@/api/library";
import type { ManagedFolder } from "../../../../shared/folders";
import type { LibrarySource } from "../../../../shared/library";
import { FolderBrowser } from "./FolderBrowser";
import type { SourceSettingsProps, SourceCredentials } from "@/components/sourceTypes";

type FolderView = LibrarySource & Partial<Pick<ManagedFolder, "verified" | "scannedItems">>;
type FolderAction = "add" | "scan" | "test" | "verify" | "remove";
export const folderStatus: Record<LibrarySource["status"], string> = { idle: "Not scanned", scanning: "Scanning", ready: "Up to date", unavailable: "Unavailable", error: "Scan failed" };
const empty: SourceCredentials = { origin: "", token: "" };

export function FolderSettings({ credentials, connected, canManage, hostName }: SourceSettingsProps) {
  const queryClient = useQueryClient();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ source: FolderView; action: "remove" | "verify" } | null>(null);
  const available = connected && !!credentials;
  const page = useQuery({ ...libraryFoldersQuery(credentials ?? empty, canManage), enabled: available });
  const mutation = useMutation({
    mutationFn: async ({ action, source, path }: { action: FolderAction; source?: FolderView; path?: string }) => {
      const suffix = action === "add" ? "" : `/${encodeURIComponent(source!.id)}${action === "remove" ? "" : `/${action}`}`;
      await apiFetch(credentials!, `/api/library/sources${suffix}`, {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "add" ? JSON.stringify({ path }) : action === "verify" ? JSON.stringify({ confirmed: true }) : undefined,
      });
    },
    onSuccess: async (_, { action }) => {
      await queryClient.invalidateQueries({ queryKey: ["library"] });
      setBrowserOpen(false);
      if (action === "test") toast("Folder is readable.");
    },
  });
  const canWrite = available && canManage && !mutation.isPending;
  const update = (action: FolderAction, source?: FolderView, path?: string) => { if (canWrite) mutation.mutate({ action, source, path }); };
  const sources: FolderView[] = page.data?.sources ?? [];
  const error = mutation.error ? mutation.error.message || "Couldn't update the folder." : page.error ? page.error.message || "Couldn't load folders." : null;

  return (
    <div className="flex min-w-0 flex-col gap-8" data-folder-settings>
      <SettingsSection description={`Folders on ${deviceName(hostName)}, not this remote.`} data-tv-local-only>
        {!canManage && <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p>}
        {available && page.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>}
        {page.data && !sources.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>No folders yet. Add a folder to find its media.</EmptyDescription></EmptyHeader></Empty>}
        {sources.map(source => (
          <SettingsRow key={source.id} data-folder-source={source.id} label={<span className="break-all">{source.name}</span>} description={<>
            {canManage && source.path && <span className="block break-all">{source.path}</span>}
            <span className="block" role={source.status === "scanning" ? "status" : undefined}>{source.status === "scanning" ? `Scanning… ${(source.scannedItems ?? 0).toLocaleString()} files checked` : `${folderStatus[source.status]} · ${source.itemCount.toLocaleString()} items`}</span>
            {source.error && <span className="block text-destructive">{source.error}</span>}
            {source.warning && <span className="block">{source.warning}</span>}
          </>}>
            {canManage && <>
              {source.verified === false ? <Button variant="outline" disabled={!canWrite} onClick={() => setConfirm({ source, action: "verify" })}>Verify folder</Button> : <>
                <Button variant="outline" disabled={!canWrite || source.status === "scanning"} onClick={() => update("scan", source)}>{source.lastScanned ? "Rescan" : "Scan"}</Button>
                <Button variant="ghost" disabled={!canWrite || source.status === "scanning"} onClick={() => update("test", source)}>Test</Button>
              </>}
              <Button variant="ghost" disabled={!canWrite || source.status === "scanning"} onClick={() => setConfirm({ source, action: "remove" })}>Remove</Button>
            </>}
          </SettingsRow>
        ))}
        {canManage && !browserOpen && <div><Button disabled={!canWrite} onClick={() => setBrowserOpen(true)}>Add folder</Button></div>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription>{page.error && !mutation.error && <AlertAction><Button variant="outline" size="sm" disabled={!available || mutation.isPending} onClick={() => void page.refetch()}>Try again</Button></AlertAction>}</Alert>}
      </SettingsSection>
      {canManage && browserOpen && credentials && <FolderBrowser canWrite={canWrite} credentials={credentials} hostName={hostName} adding={mutation.isPending && mutation.variables?.action === "add"} onAdd={path => update("add", undefined, path)} onCancel={() => setBrowserOpen(false)} />}
      <AlertDialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.action === "remove" ? `Remove ${confirm.source.name}?` : "Verify this folder?"}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{confirm?.action === "remove" ? "Files and history stay; queued items from it stop working." : `Is ${confirm?.source.path} still the original folder on the original drive?`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={confirm?.action === "remove" ? "destructive" : "default"} onClick={() => confirm && update(confirm.action, confirm.source)}>{confirm?.action === "remove" ? "Remove" : "Yes, verify"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
