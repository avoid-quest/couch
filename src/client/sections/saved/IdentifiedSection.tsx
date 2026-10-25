import { useQuery } from "@tanstack/react-query";
import type { ApiCredentials } from "@/api/client";
import { radioRecognitionsQuery } from "@/api/radio";
import { RadioRecognitionItem } from "@/components/RadioRecognitionItem";
import { SavedEmpty, SavedError, SavedStatus } from "./SavedStatus";

export function IdentifiedSection({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const { data, error, isPending, refetch } = useQuery({ ...radioRecognitionsQuery(credentials), enabled: connected });
  const items = connected ? data?.items ?? [] : [];
  return <section aria-label="Identified songs">
    <SavedStatus connected={connected} loading={connected && isPending} />
    {connected && error && <SavedError message={error.message} onRetry={() => void refetch()} />}
    {connected && !isPending && !error && !items.length && <SavedEmpty title="No identified songs yet">Choose Identify song while a radio station is playing. Completed lookups appear here automatically.</SavedEmpty>}
    {!!items.length && <ul className="grid list-none p-0">
      {items.map(entry => <li key={entry.id} className="border-b border-border/60 py-4 first:pt-0"><RadioRecognitionItem entry={entry} history /></li>)}
    </ul>}
  </section>;
}
