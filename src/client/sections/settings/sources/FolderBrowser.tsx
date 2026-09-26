import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, FolderOpen } from "lucide-react";
import { SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { deviceName } from "@/copy";
import { folderBrowseQuery } from "@/api/library";
import type { SourceCredentials } from "@/components/sourceTypes";

type Props = { credentials: SourceCredentials; canWrite: boolean; adding: boolean; hostName?: string; onAdd: (path: string) => void; onCancel: () => void };

export function FolderBrowser({ credentials, canWrite, adding, hostName, onAdd, onCancel }: Props) {
  const [location, setLocation] = useState<{ path: string | null; offset: number }>({ path: null, offset: 0 });
  const folders = useQuery({ ...folderBrowseQuery(credentials, location.path, location.offset), placeholderData: keepPreviousData });
  const browser = folders.data;
  const error = folders.error ? folders.error.message || "Couldn't open this folder." : null;
  const browse = (path: string | null = null, offset = 0) => { if (canWrite) setLocation({ path, offset }); };
  const path = browser?.path;

  return (
    <SettingsSection aria-label="Folder browser" title={`Choose a folder on ${deviceName(hostName)}`} description="Mount drives and shares first. Couch never moves files." data-tv-local-only>
      {browser && <div className="flex min-w-0 flex-wrap items-center gap-2">
        {browser.path && <Button variant="ghost" className="-ml-2.5" disabled={!canWrite} onClick={() => browse(browser.parent)}><ArrowLeft aria-hidden="true" />{browser.parent ? "Up" : "Locations"}</Button>}
        <span className="min-w-0 break-all text-sm text-muted-foreground">{browser.path ?? "Locations"}</span>
      </div>}
      {!browser && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>}
      {browser && <ul className="flex min-w-0 flex-col border-t">
        {browser.locations.map(location => (
          <li className="border-b py-1" key={location.path}>
            <Button className="-mx-2.5 flex h-auto min-h-8 touch:min-h-11 justify-start whitespace-normal text-left font-normal" disabled={!canWrite || !!location.error} variant="ghost" onClick={() => browse(location.path)}>
              <FolderOpen aria-hidden="true" /><span className="min-w-0 flex-1 break-all">{location.name}</span><ChevronRight aria-hidden="true" className="text-muted-foreground" />
            </Button>
            {location.error && <p className="pb-1 text-xs break-words text-muted-foreground">{location.error}</p>}
          </li>
        ))}
        {!browser.locations.length && <li><Empty className="py-0"><EmptyHeader><EmptyDescription>No subfolders here. Add this folder or choose another location.</EmptyDescription></EmptyHeader></Empty></li>}
      </ul>}
      {browser && (browser.offset > 0 || browser.more) && <div aria-label="Folder pages" className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!canWrite || browser.offset === 0} onClick={() => browse(browser.path, Math.max(0, browser.offset - 100))}>Previous</Button>
        <Button variant="outline" disabled={!canWrite || !browser.more} onClick={() => browse(browser.path, browser.offset + 100)}>Next</Button>
      </div>}
      <div className="flex flex-wrap gap-2">
        {path && !["/media", "/mnt"].includes(path) && <Button disabled={!canWrite} onClick={() => onAdd(path)}>{adding ? "Adding…" : "Add this folder"}</Button>}
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={!canWrite} onClick={() => void folders.refetch()}>Try again</Button></AlertAction></Alert>}
    </SettingsSection>
  );
}
