import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { folderBrowseQuery } from "@/api/library";
import type { SourceCredentials } from "@/components/sourceTypes";

type Props = { credentials: SourceCredentials; canWrite: boolean; onAdd: (path: string) => void };

export function FolderBrowser({ credentials, canWrite, onAdd }: Props) {
  const [location, setLocation] = useState<{ path: string | null; offset: number }>({ path: null, offset: 0 });
  const folders = useQuery({ ...folderBrowseQuery(credentials, location.path, location.offset), placeholderData: keepPreviousData });
  const browser = folders.data;
  const pending = folders.isFetching;
  const error = folders.error ? folders.error instanceof Error ? folders.error.message : "Could not open this TV folder." : null;
  const browse = (path: string | null = null, offset = 0) => { if (canWrite) setLocation({ path, offset }); };

  if (!browser) return <p className="text-muted-foreground" role="status">{pending ? "Opening folders…" : error ?? "Loading permitted folders…"}</p>;
  const path = browser.path;

  return (
    <div aria-label="TV folder browser" className="min-w-0 space-y-3">
      <div className="space-y-1"><p className="font-medium">Choose a folder on the TV</p><p className="break-all text-sm text-muted-foreground">{browser.path ?? "Permitted media locations"}</p></div>
      <div className="flex flex-wrap gap-2">
        {browser.path && <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => browse(browser.parent)}><ArrowLeft aria-hidden="true" />{browser.parent ? "Parent folder" : "Media locations"}</Button>}
        <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void folders.refetch()}><RefreshCw aria-hidden="true" />Refresh</Button>
      </div>
      <ul className="divide-y border-t border-border">
        {browser.locations.map(location => (
          <li className="min-w-0 space-y-1 py-2" key={location.path}>
            <Button className="h-auto min-h-11 w-full justify-start rounded-none px-0 whitespace-normal text-left" disabled={!canWrite || !!location.error} variant="ghost" onClick={() => browse(location.path)}>
              <FolderOpen aria-hidden="true" className="shrink-0" /><span className="min-w-0 break-all">{location.name}</span>
            </Button>
            {location.error && <p className="break-words text-sm text-destructive">{location.error}</p>}
          </li>
        ))}
      </ul>
      {!browser.locations.length && <p className="text-sm text-muted-foreground">No subfolders here.</p>}
      {(browser.offset > 0 || browser.more) && (
        <div aria-label="Folder pages" className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" disabled={!canWrite || browser.offset === 0} onClick={() => browse(browser.path, Math.max(0, browser.offset - 100))}>Previous folders</Button>
          <Button variant="outline" className="min-h-11" disabled={!canWrite || !browser.more} onClick={() => browse(browser.path, browser.offset + 100)}>Next folders</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {path && !["/media", "/mnt"].includes(path) && (
          <Button className="min-h-11" disabled={!canWrite} onClick={() => onAdd(path)}><Plus aria-hidden="true" />{pending ? "Testing folder…" : "Test and add this folder"}</Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">Couch uses these permitted locations. It does not mount network shares or move files. Add each mounted folder as its own source.</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
