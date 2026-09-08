import { useEffect, useRef, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ForLaterReference } from "../shared/for-later";

export function SaveForLater({ origin, token, connected, reference, title }: {
  origin: string; token: string; connected: boolean; reference: ForLaterReference; title: string;
}) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { setPending(false); setNotice(""); return () => controller.current?.abort(); }, [origin, token, connected, reference.kind, reference.id]);
  const save = async () => {
    if (!connected || pending) return;
    const request = new AbortController();
    controller.current = request;
    setPending(true); setNotice("");
    try {
      const response = await fetch(`${origin}/api/for-later`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ reference }), signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save this item.");
      if (!request.signal.aborted) setNotice("Saved for everyone on this TV.");
    } catch (error) { if (!request.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not save this item."); }
    finally { if (!request.signal.aborted) setPending(false); }
  };
  return <div className="grid gap-1"><Button variant="outline" aria-label={`Save ${title} for later`} disabled={!connected || pending} onClick={() => void save()}><BookmarkPlus aria-hidden="true" />For later</Button>{notice && <p className="text-sm" role="status">{notice}</p>}</div>;
}
