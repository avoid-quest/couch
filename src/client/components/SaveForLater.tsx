import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiSend, type ApiCredentials } from "@/api/client";
import type { ForLaterReference } from "../../shared/for-later";

// The server bumps the for-later revision, so every Saved view refetches.
export function SaveForLater({ origin, token, sessionMode, playbackId, connected, reference, title }: ApiCredentials & { connected: boolean; reference: ForLaterReference; title: string;
}) {
  const save = useMutation({
    mutationFn: () => apiSend({ origin, token, sessionMode, playbackId }, "/api/for-later", { reference }, "POST", 20_000),
    onError: error => toast.error(error.message || `Couldn't save ${title}.`),
  });
  return <Button variant="ghost" aria-label={`Save ${title}`} disabled={!connected || save.isPending} onClick={() => save.mutate()}>Save</Button>;
}
