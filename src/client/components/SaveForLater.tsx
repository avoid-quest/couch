import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiSend } from "@/api/client";
import type { ForLaterReference } from "../../shared/for-later";

// The server bumps the for-later revision, so every Saved view refetches.
export function SaveForLater({ origin, token, connected, reference, title }: {
  origin: string; token: string; connected: boolean; reference: ForLaterReference; title: string;
}) {
  const save = useMutation({ mutationFn: () => apiSend({ origin, token }, "/api/for-later", { reference }, "POST", 20_000) });
  const referenceKey = reference.kind === "web" ? `web:${reference.url}` : reference.id;
  useEffect(() => save.reset(), [referenceKey]);
  const notice = save.isSuccess ? "Saved for everyone on this TV." : save.error ? save.error.message || "Could not save this item." : "";
  return <div className="grid gap-1"><Button variant="outline" aria-label={`Save ${title} for later`} disabled={!connected || save.isPending} onClick={() => save.mutate()}><BookmarkPlus aria-hidden="true" />Save</Button>{notice && <p className="text-sm" role="status">{notice}</p>}</div>;
}
