import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiJson } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useSessionGate } from "@/session/session-context";
import type { UpdateCenterTarget } from "@/session/update-center";
import { compareUpdateVersions, type ReleaseHistory, type ReleaseNotes as Release } from "../../../shared/releases";
import { isUpdateVersion } from "../../../shared/updates";

function ReleaseEntry({ release }: { release: Release }) {
  return <article className="space-y-3">
    <div>
      <h3 className="text-base font-medium">Couch {release.version}</h3>
      <p className="text-sm text-muted-foreground">{release.version.includes("-preview.") ? "Preview" : "Stable"}{release.publishedAt && `, ${new Date(release.publishedAt).toLocaleDateString(undefined, { dateStyle: "long" })}`}</p>
    </div>
    {release.items.length > 0 && <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">{release.items.map((item, index) => <li className="whitespace-pre-wrap break-words" key={index}>{item}</li>)}</ul>}
    <a href={release.url} target="_blank" rel="noreferrer" className="inline-block text-sm text-muted-foreground underline underline-offset-4">Full release on GitHub<span className="sr-only"> (opens in a new tab)</span></a>
  </article>;
}

/** Mounted only when someone opens the review or expands notes in Settings. */
export function ReleaseNotes({ targets }: { targets: UpdateCenterTarget[] }) {
  const { credentials } = useSessionGate();
  const [selected, setSelected] = useState("");
  const [older, setOlder] = useState(false);
  const choices = targets.filter(target => target.state);
  // Devices on the same channel and versions read the same notes, so the picker shows only when they differ.
  const ranges = new Set(choices.map(({ state }) => `${state!.channel} ${state!.version} ${state!.available}`));
  const target = choices.find(target => target.id === selected) ?? choices.find(target => target.state?.available) ?? choices[0];
  const channel = target?.state?.channel ?? "latest";
  const query = useInfiniteQuery({
    queryKey: ["updates", "releases", channel], enabled: !!credentials, initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => apiJson<ReleaseHistory>(credentials!, `/api/updates/releases?channel=${channel}&page=${pageParam}`, { signal }),
    getNextPageParam: (page, pages) => page.more ? pages.length + 1 : undefined,
    staleTime: 5 * 60_000, retry: false,
  });
  const releases = query.data?.pages.flatMap(page => page.releases) ?? [];
  const installed = target?.state?.version;
  const available = target?.state?.available;
  const changed = releases.filter(release => {
    if (!available) return installed ? release.version === installed : release === releases[0];
    if (release.version === available) return true;
    if (!installed || !isUpdateVersion(installed) || !isUpdateVersion(available)) return false;
    const after = compareUpdateVersions(release.version, installed), before = compareUpdateVersions(release.version, available);
    return after !== null && before !== null && after > 0 && before <= 0;
  });
  const history = releases.filter(release => !changed.includes(release));
  return <div className="max-w-[72ch] space-y-5">
    {ranges.size > 1 && <Select value={target?.id} onValueChange={setSelected}>
      <SelectTrigger aria-label="Release notes for device" className="w-full sm:w-72"><SelectValue /></SelectTrigger>
      <SelectContent>{choices.map(item => <SelectItem value={item.id} key={item.id}>{item.name}</SelectItem>)}</SelectContent>
    </Select>}
    {available && installed && isUpdateVersion(installed) && isUpdateVersion(available) && compareUpdateVersions(available, installed) > 0 && <p className="text-sm text-muted-foreground">Changes since {installed}</p>}
    {query.isPending && credentials && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading release notes…</p>}
    {(!credentials || query.isError) && <p className="text-sm text-muted-foreground">Release notes are unavailable. You can still update.{credentials && <> <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Try again</Button></>}</p>}
    {changed.map(release => <ReleaseEntry release={release} key={release.version} />)}
    {query.isSuccess && !changed.length && <p className="text-sm text-muted-foreground">{available || installed ? `No release notes found for Couch ${available ?? installed}. You can still update.` : "No release notes found."}</p>}
    {(history.length > 0 || query.hasNextPage) && <Collapsible open={older} onOpenChange={setOlder}>
      <CollapsibleTrigger asChild><Button variant="ghost" className="-ml-3">{older ? "Hide release history" : "Release history"}</Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-6 pt-3">
        {history.map(release => <ReleaseEntry release={release} key={release.version} />)}
      </CollapsibleContent>
    </Collapsible>}
    {query.hasNextPage && (older || !changed.length) && <Button variant="ghost" className="-ml-3" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading…" : "Load older releases"}</Button>}
  </div>;
}
