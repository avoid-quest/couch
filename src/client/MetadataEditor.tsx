import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { isNativeHost } from "./session/native-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { MetadataCandidate, MetadataPreview, MetadataValues, MetadataView } from "../shared/metadata";

const fields = { title: "Title", originalTitle: "Original title", showTitle: "Series title", plot: "Plot", year: "Release year", premiered: "Release date", genres: "Genres, one per line", season: "Season", episode: "Episode" } as const;
type Field = keyof typeof fields;
const draftOf = (values: MetadataValues) => Object.fromEntries(Object.keys(fields).map(key => { const value = values[key as Field]; return [key, Array.isArray(value) ? value.join("\n") : value === null ? "" : String(value)]; })) as Record<Field, string>;
const valuesOf = (draft: Record<Field, string>) => Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, key === "genres" ? value.split("\n").map(v => v.trim()).filter(Boolean) : ["year", "season", "episode"].includes(key) ? value.trim() ? Number(value) : null : value.trim() || null])) as Partial<MetadataValues>;

export function MetadataEditor({ origin, token, id, connected, onSaved }: { origin: string; token: string; id: string; connected: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [metadata, setMetadata] = useState<MetadataView | null>(null);
  const [draft, setDraft] = useState<Record<Field, string> | null>(null);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [artwork, setArtwork] = useState<string | null>(null);
  const [clearArtwork, setClearArtwork] = useState(false);
  const [clearMatch, setClearMatch] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetadataCandidate[] | null>(null);
  const [preview, setPreview] = useState<MetadataPreview | null>(null);
  const request = useRef<AbortController | null>(null);
  const fileRead = useRef<FileReader | null>(null);
  const context = useRef("");
  const artworkInput = useRef<HTMLInputElement | null>(null);
  const clearSelectedArtwork = () => { setArtwork(null); if (artworkInput.current) artworkInput.current.value = ""; };
  const prefix = useId();
  const native = isNativeHost();
  const busy = !connected || pending || reading;
  const reset = (value: MetadataView) => { setMetadata(value); setDraft(draftOf(value.values)); clearSelectedArtwork(); setClearArtwork(false); setClearMatch(false); setPreview(null); };
  const cancel = () => { request.current?.abort(); request.current = null; fileRead.current?.abort(); fileRead.current = null; };

  useEffect(() => {
    const key = JSON.stringify([open, origin, token, id]);
    const changed = context.current !== key;
    request.current?.abort(); request.current = null; setPending(false);
    if (changed) {
      context.current = key; fileRead.current?.abort(); fileRead.current = null; setReading(false);
      setMetadata(null); setDraft(null); setArtwork(null); setClearArtwork(false); setClearMatch(false); setError(null); setNotice(null); setPreview(null); setResults(null);
    }
    if (!open || !connected || !changed && metadata) return;
    const controller = new AbortController(); request.current = controller; setPending(true);
    void fetch(`${origin}/api/metadata/items/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not load metadata."); return value as MetadataView; })
      .then(value => { if (!controller.signal.aborted) { reset(value); setQuery(value.type === "episode" ? value.values.showTitle ?? "" : value.values.title); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load metadata."); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => { request.current?.abort(); request.current = null; };
  }, [open, connected, origin, token, id]);
  useEffect(() => cancel, []);

  async function update(action: "edit" | "search" | "preview" | "match" | "export", body: unknown) {
    if (busy || request.current && !request.current.signal.aborted && pending) return;
    cancel(); const controller = new AbortController(); request.current = controller;
    setPending(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${origin}/api/metadata/items/${id}/${action}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      if (!response.ok) { const value = await response.json(); throw new Error(value.error || "Could not update metadata."); }
      if (action === "export") {
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = `couch-metadata-${id}.tar`; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        setNotice("Export sent to this browser's download destination. Open the archive's placement.json before replacing any sidecars.");
      } else {
        const value = await response.json();
        if (controller.signal.aborted) return;
        if (action === "search") { setResults(value.items); setPreview(null); }
        else if (action === "preview") setPreview(value);
        else { reset(value); setNotice("Metadata saved."); onSaved(); }
      }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not update metadata."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!metadata || !draft) return;
    const values = valuesOf(draft);
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(metadata.values[key as Field])));
    if (clearArtwork) changes.artworkId = null;
    if (!Object.keys(changes).length && !artwork && !clearMatch) { setNotice("No corrections to save."); return; }
    void update("edit", { revision: metadata.revision, changes, ...(artwork ? { artwork } : {}), ...(clearMatch ? { clearMatch: true } : {}) });
  }
  function selectArtwork(file?: File) {
    fileRead.current?.abort(); setArtwork(null); setError(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Choose a PNG or JPEG up to 2 MiB."); return; }
    const reader = new FileReader(); fileRead.current = reader; setReading(true);
    reader.onload = () => { if (fileRead.current === reader && typeof reader.result === "string") { setArtwork(reader.result.split(",")[1]!); setClearArtwork(false); setReading(false); } };
    reader.onerror = () => { if (fileRead.current === reader) { setError("Could not read the selected artwork."); setReading(false); } };
    reader.onabort = () => { if (fileRead.current === reader) setReading(false); };
    reader.readAsDataURL(file);
  }
  return <section className="metadata-editor min-w-0 space-y-3 border-t pt-3" data-tv-local-only aria-label="Video metadata corrections">
    <Button type="button" variant="outline" disabled={!connected} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Close metadata editor" : "Edit metadata"}</Button>
    {open && <>
      <p className="text-sm text-muted-foreground">Administrator corrections are saved on the TV and kept through rescans. Original files are preserved.</p>
      {error && <Alert variant="destructive"><AlertDescription>{error} <Button type="button" variant="link" onClick={() => { setOpen(false); }}>Close and reopen to reload</Button></AlertDescription></Alert>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!connected && <p role="status" className="text-sm">Offline. Your draft is kept here. Reconnect to save, search or export.</p>}
      {pending && <p role="status" className="text-sm">Working…</p>}
      {metadata && draft && <>
        <form className="space-y-3" onSubmit={save}>
          {(Object.entries(fields) as Array<[Field, string]>).filter(([key]) => metadata.type === "episode" || !["showTitle", "season", "episode"].includes(key)).map(([key, label]) => <div className="space-y-1" key={key}>
            <Label htmlFor={`${prefix}-${key}`}>{label}</Label><p id={`${prefix}-${key}-origin`} className="text-xs text-muted-foreground">Origin: {metadata.origins[key]}</p>
            {key === "plot" || key === "genres" ? <Textarea id={`${prefix}-${key}`} data-metadata-field={key} className="min-h-22" rows={key === "plot" ? 4 : 2} value={draft[key]} maxLength={key === "plot" ? 4000 : 1296} disabled={busy} aria-describedby={`${prefix}-${key}-origin`} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
              : <Input id={`${prefix}-${key}`} data-metadata-field={key} className="min-h-11" type={["year", "season", "episode"].includes(key) ? "number" : key === "premiered" ? "date" : "text"} min={key === "year" ? 1000 : 0} max={key === "season" ? 999 : 9999} maxLength={300} required={key === "title" || key === "showTitle"} value={draft[key]} disabled={busy} aria-describedby={`${prefix}-${key}-origin`} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />}
          </div>)}
          <div className="space-y-1"><Label htmlFor={`${prefix}-artwork`}>Replace artwork</Label><p className="text-xs text-muted-foreground">Origin: {metadata.origins.artworkId}. PNG or JPEG, up to 2 MiB.</p><Input ref={artworkInput} id={`${prefix}-artwork`} data-metadata-artwork className="min-h-11" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event => selectArtwork(event.target.files?.[0])} />{artwork && <p className="text-sm">Artwork selected. Save corrections to apply it.</p>}</div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={clearArtwork} disabled={busy} onChange={event => { setClearArtwork(event.target.checked); clearSelectedArtwork(); }} />Remove the current artwork</label>
          <p className="break-words text-sm">Saved match: {metadata.match ? `TMDB ${metadata.match.title} (${metadata.match.id})` : "No chosen TMDB match"}</p>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={clearMatch} disabled={busy} onChange={event => setClearMatch(event.target.checked)} />Clear the TMDB match and its exported ID</label>
          <Button className="min-h-11" disabled={busy} type="submit">Save corrections</Button>
        </form>
        <form className="space-y-3 border-t pt-3" onSubmit={event => { event.preventDefault(); void update("search", { query }); }}>
          <Label htmlFor={`${prefix}-search`}>{metadata.type === "episode" ? "Search TMDB series" : "Search TMDB movies"}</Label><Input id={`${prefix}-search`} data-metadata-search className="min-h-11" value={query} maxLength={200} disabled={busy} onChange={event => setQuery(event.target.value)} required />
          <p className="text-sm text-muted-foreground">Requires an authorized TMDB token in Settings → Sources. {metadata.type === "episode" && "The season and episode numbers above select an episode from the chosen series."}</p>
          <Button className="min-h-11" type="submit" variant="secondary" disabled={busy}>Search TMDB</Button>
        </form>
        {results && <ul className="space-y-2" aria-label="TMDB search results">{results.map(result => <li key={result.id}><Button type="button" className="h-auto min-h-11 w-full whitespace-normal text-left" variant="outline" disabled={busy} onClick={() => void update("preview", { revision: metadata.revision, id: result.id, season: draft.season === "" ? null : Number(draft.season), episode: draft.episode === "" ? null : Number(draft.episode) })}>Preview {result.title} {result.year}</Button><p className="text-sm text-muted-foreground">{result.description}</p></li>)}{!results.length && <li>No matches. Try another title.</li>}</ul>}
        {preview && <div className="space-y-3 rounded-md border p-3" aria-label="TMDB match preview"><h4 className="font-medium">Preview: {preview.match.title}</h4>
          {preview.artwork && <img src={preview.artwork} alt="TMDB preview artwork" className="max-h-52 max-w-full object-contain" />}
          <dl className="space-y-2 text-sm">{(Object.keys(fields) as Field[]).filter(key => metadata.type === "episode" || !["showTitle", "season", "episode"].includes(key)).map(key => <div key={key}><dt className="text-muted-foreground">{fields[key]}</dt><dd className="break-words whitespace-pre-wrap">{Array.isArray(preview.values[key]) ? (preview.values[key] as string[]).join(", ") : preview.values[key] ?? "Empty"}</dd></div>)}</dl>
          <p className="text-sm">Applying replaces all previewed fields and artwork, including manual corrections. A missing preview image clears artwork. Preview expires at {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
          <Button className="min-h-11" type="button" disabled={busy} onClick={() => void update("match", { revision: metadata.revision, previewId: preview.id })}>Apply this match</Button>
        </div>}
        <div className="space-y-2 border-t pt-3"><h4 className="font-medium">Export saved metadata</h4>{native ? <p className="text-sm">On your paired administrator phone or browser, open Library → Movies or Shows → this video's details → Edit metadata → Download saved metadata.</p> : <><p className="text-sm">Download a TAR archive to this browser's download destination. It contains saved NFO, artwork and placement instructions. Unsaved edits are excluded. Review it before replacing any sidecars.</p><Button className="min-h-11" type="button" variant="outline" disabled={busy} onClick={() => void update("export", { revision: metadata.revision })}>Download saved metadata</Button></>}</div>
      </>}
    </>}
  </section>;
}
