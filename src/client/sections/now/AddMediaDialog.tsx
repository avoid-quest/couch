import { useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Action, VideoQuality } from "../../../shared/protocol";
import { QualitySelect } from "@/components/QualitySelect";
import { supportsWebVideoQuality, useEnqueueVideoQuality } from "../../video-quality";
import { createId, type Credentials } from "../../session/session";

// Add-media owns only URL intake; the queue owns ordering and playback.
export function AddMediaDialog({ credentials, connected, defaultQuality, run }: {
  credentials: Credentials;
  connected: boolean;
  defaultQuality: VideoQuality;
  run: (action: Action) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [sourceKind, setSourceKind] = useState<"direct" | "webpage">("direct");
  const [title, setTitle] = useState("");
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(defaultQuality);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const offersVideoQuality = sourceKind === "webpage" && supportsWebVideoQuality(source);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!connected || adding) return;
    setError(null);
    let url: URL;
    try {
      url = new URL(source.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      setError("Enter a URL beginning with http:// or https://.");
      sourceRef.current?.focus();
      return;
    }
    if (url.username || url.password) {
      setError("Use a public link without a username or password.");
      sourceRef.current?.focus();
      return;
    }
    setAdding(true);
    try {
      const action: Action = sourceKind === "webpage"
        ? { type: "enqueueWeb", entryId: createId(), url: url.href, title: title.trim() || undefined, ...(offersVideoQuality ? { quality } : {}) }
        : { type: "enqueue", entry: { id: createId(), source: url.href, title: title.trim() || url.hostname } };
      if (await run(action)) {
        resetQuality();
        setSource("");
        setTitle("");
        setOpen(false);
      } else setError("Could not add this link. Check the link and your connection, then try again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add this link.");
    } finally {
      setAdding(false);
    }
  };

  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) { resetQuality(); setError(null); } }}>
    <DialogTrigger asChild><Button disabled={!connected}><Plus aria-hidden="true" />Add media</Button></DialogTrigger>
    <DialogContent className="queue-add-dialog max-h-[85dvh] overflow-y-auto pr-8 sm:max-w-xl" onOpenAutoFocus={event => { event.preventDefault(); sourceRef.current?.focus(); }}>
      <DialogHeader><DialogTitle>Add media</DialogTitle><DialogDescription>Paste a link to add it to the TV queue.</DialogDescription></DialogHeader>
      <form className="grid min-w-0 gap-4" aria-busy={adding} onSubmit={event => void add(event)}>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {!connected && <Alert><AlertDescription>Reconnect to add this link. Your draft is saved here.</AlertDescription></Alert>}
        <div className="grid min-w-0 gap-2"><Label htmlFor="media-kind">Link type</Label>
          <Select value={sourceKind} disabled={!connected || adding} onValueChange={value => setSourceKind(value as "direct" | "webpage")}>
            <SelectTrigger id="media-kind" className="w-full min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="direct">Direct media</SelectItem><SelectItem value="webpage">Webpage</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-2"><Label htmlFor="media-url">{sourceKind === "webpage" ? "Webpage URL" : "Direct media URL"}</Label>
          <Input ref={sourceRef} id="media-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://…" maxLength={4096} className="min-h-11" value={source} onChange={event => setSource(event.target.value)} disabled={!connected || adding} required aria-describedby="media-link-help" />
          <p id="media-link-help" className="text-sm text-muted-foreground">{sourceKind === "webpage" ? "A video or album page from a supported site." : "A direct link to a video, audio file, or live stream."}</p>
        </div>
        <div className="grid min-w-0 gap-2"><Label htmlFor="media-title">Title <span className="text-xs text-muted-foreground">optional</span></Label><Input id="media-title" className="min-h-11" placeholder={sourceKind === "webpage" ? "Fetched automatically" : "Give it a name"} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} disabled={!connected || adding} /></div>
        {offersVideoQuality && <QualitySelect id="media-quality" label="This video quality" description="Overrides your default for this video only." value={quality} disabled={!connected || adding} onChange={setQuality} />}
        <Button type="submit" className="mt-0.5 w-full min-h-11" disabled={!connected || adding || !source.trim()}><Plus aria-hidden="true" />{adding ? "Adding…" : "Add to queue"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
