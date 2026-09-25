import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { isNativeHost } from "@/session/native-context";
import { usePlaybackDevice } from "@/sections/shell/PlaybackDevice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field as FormField, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/api/client";
import type { MetadataCandidate, MetadataPreview, MetadataValues, MetadataView } from "../../shared/metadata";

const fields = { title: "Title", originalTitle: "Original title", showTitle: "Series title", plot: "Plot", year: "Release year", premiered: "Release date", genres: "Genres, one per line", season: "Season", episode: "Episode" } as const;
type Field = keyof typeof fields;
type Props = { origin: string; token: string; id: string; connected: boolean; onSaved: () => void };
const draftOf = (values: MetadataValues) => Object.fromEntries(Object.keys(fields).map(key => { const value = values[key as Field]; return [key, Array.isArray(value) ? value.join("\n") : value === null ? "" : String(value)]; })) as Record<Field, string>;
const valuesOf = (draft: Record<Field, string>) => Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, key === "genres" ? value.split("\n").map(v => v.trim()).filter(Boolean) : ["year", "season", "episode"].includes(key) ? value.trim() ? Number(value) : null : value.trim() || null])) as Partial<MetadataValues>;

export function MetadataEditor({ origin, token, id, connected, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<Field, string> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [artwork, setArtwork] = useState<string | null>(null);
  const [clearArtwork, setClearArtwork] = useState(false);
  const [clearMatch, setClearMatch] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetadataCandidate[] | null>(null);
  const [preview, setPreview] = useState<MetadataPreview | null>(null);
  const fileRead = useRef<FileReader | null>(null);
  const artworkInput = useRef<HTMLInputElement | null>(null);
  const prefix = useId();
  const device = usePlaybackDevice();
  const native = isNativeHost() && device?.mode !== "remote";
  const page = useQuery({
    enabled: open && connected,
    queryKey: ["metadata", "item", id],
    queryFn: () => apiFetch({ origin, token }, `/api/metadata/items/${id}`).then(async response => {
      const value = await response.json() as MetadataView & { error?: string };
      if (!response.ok) throw new Error(value.error || "Could not load metadata.");
      return value;
    }),
  });
  const metadata = page.data ?? null;
  const busy = !connected || pending || page.isFetching;
  const clearSelectedArtwork = () => { setArtwork(null); if (artworkInput.current) artworkInput.current.value = ""; };
  const reset = (value: MetadataView) => { setDraft(draftOf(value.values)); clearSelectedArtwork(); setClearArtwork(false); setClearMatch(false); setPreview(null); };

  useEffect(() => {
    if (!metadata) return;
    reset(metadata);
    setQuery(metadata.type === "episode" ? metadata.values.showTitle ?? "" : metadata.values.title);
  }, [metadata]);
  useEffect(() => () => { fileRead.current?.abort(); fileRead.current = null; }, []);

  async function update(action: "edit" | "search" | "preview" | "match" | "export", body: unknown) {
    if (busy) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch({ origin, token }, `/api/metadata/items/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (action === "export") {
        const archive = await response.arrayBuffer().catch(() => { throw new Error("Metadata transfer stopped before the archive was complete. No file was saved."); });
        if (native) {
          const saved = await invoke<boolean>("save_metadata_export", new Uint8Array(archive), { headers: { "X-Couch-Item-Id": id } });
          setNotice(saved ? "Metadata archive saved. Open its placement.json before replacing any sidecars." : "Export canceled. No file was saved.");
        } else {
          const url = URL.createObjectURL(new Blob([archive], { type: "application/x-tar" })), link = document.createElement("a");
          link.href = url; link.download = `couch-metadata-${id}.tar`; document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1_000);
          setNotice("Export sent to this browser's download destination. Open the archive's placement.json before replacing any sidecars.");
        }
        return;
      }
      const value = await response.json();
      if (action === "search") { setResults(value.items); setPreview(null); }
      else if (action === "preview") setPreview(value);
      else {
        reset(value);
        setNotice("Metadata saved.");
        onSaved();
        await queryClient.invalidateQueries({ queryKey: ["metadata", "item", id] });
        await queryClient.invalidateQueries({ queryKey: ["library"] });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : action === "export" ? "Could not save metadata archive. No complete file was saved." : "Could not update metadata.");
    } finally {
      setPending(false);
    }
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
    fileRead.current?.abort();
    setArtwork(null);
    setError(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Choose a PNG or JPEG up to 2 MiB."); return; }
    const reader = new FileReader();
    fileRead.current = reader;
    setPending(true);
    reader.onload = () => { if (fileRead.current === reader && typeof reader.result === "string") { setArtwork(reader.result.split(",")[1]!); setClearArtwork(false); setPending(false); } };
    reader.onerror = () => { if (fileRead.current === reader) { setError("Could not read the selected artwork."); setPending(false); } };
    reader.onabort = () => { if (fileRead.current === reader) setPending(false); };
    reader.readAsDataURL(file);
  }

  return (
    <section aria-label="Video metadata corrections" className="min-w-0 space-y-3 border-t pt-3" data-tv-local-only>
      <Button aria-expanded={open} disabled={!connected} onClick={() => setOpen(value => !value)} type="button" variant="outline">{open ? "Close metadata editor" : "Edit metadata"}</Button>
      {open && <>
        <p className="text-sm text-muted-foreground">Administrator corrections are saved on the TV and kept through rescans. Original files are preserved.</p>
        {(page.error || error) && <Alert variant="destructive"><AlertDescription>{error ?? "Could not load metadata."} <Button onClick={() => setOpen(false)} type="button" variant="link">Close and reopen to reload</Button></AlertDescription></Alert>}
        {notice && <p className="text-sm" role="status">{notice}</p>}
        {!connected && <p className="text-sm" role="status">Offline. Your draft is kept here. Reconnect to save, search or export.</p>}
        {pending && <p className="text-sm" role="status">Working…</p>}
        {metadata && draft && <>
          <form className="space-y-3" onSubmit={save}>
            {(Object.entries(fields) as Array<[Field, string]>).filter(([key]) => metadata.type === "episode" || !["showTitle", "season", "episode"].includes(key)).map(([key, label]) => <div className="space-y-1" key={key}>
              <Label htmlFor={`${prefix}-${key}`}>{label}</Label><p className="text-xs text-muted-foreground" id={`${prefix}-${key}-origin`}>Origin: {metadata.origins[key]}</p>
              {key === "plot" || key === "genres" ? <Textarea aria-describedby={`${prefix}-${key}-origin`} className="min-h-22" data-metadata-field={key} disabled={busy} id={`${prefix}-${key}`} maxLength={key === "plot" ? 4000 : 1296} onChange={event => setDraft({ ...draft, [key]: event.target.value })} rows={key === "plot" ? 4 : 2} value={draft[key]} />
                : <Input aria-describedby={`${prefix}-${key}-origin`} className="min-h-11" data-metadata-field={key} disabled={busy} id={`${prefix}-${key}`} max={key === "season" ? 999 : 9999} maxLength={300} min={key === "year" ? 1000 : 0} onChange={event => setDraft({ ...draft, [key]: event.target.value })} required={key === "title" || key === "showTitle"} type={["year", "season", "episode"].includes(key) ? "number" : key === "premiered" ? "date" : "text"} value={draft[key]} />}
            </div>)}
            <div className="space-y-1"><Label htmlFor={`${prefix}-artwork`}>Replace artwork</Label><p className="text-xs text-muted-foreground">Origin: {metadata.origins.artworkId}. PNG or JPEG, up to 2 MiB.</p><Input accept="image/png,image/jpeg" className="min-h-11" data-metadata-artwork disabled={busy} id={`${prefix}-artwork`} onChange={event => selectArtwork(event.target.files?.[0])} ref={artworkInput} type="file" />{artwork && <p className="text-sm">Artwork selected. Save corrections to apply it.</p>}</div>
            <FormField orientation="horizontal" className="min-h-11"><Checkbox id={`${prefix}-clear-artwork`} checked={clearArtwork} disabled={busy} onCheckedChange={checked => { setClearArtwork(checked === true); clearSelectedArtwork(); }} /><FieldLabel htmlFor={`${prefix}-clear-artwork`}>Remove the current artwork</FieldLabel></FormField>
            <p className="break-words text-sm">Saved match: {metadata.match ? `TMDB ${metadata.match.title} (${metadata.match.id})` : "No chosen TMDB match"}</p>
            <FormField orientation="horizontal" className="min-h-11"><Checkbox id={`${prefix}-clear-match`} checked={clearMatch} disabled={busy} onCheckedChange={checked => setClearMatch(checked === true)} /><FieldLabel htmlFor={`${prefix}-clear-match`}>Clear the TMDB match and its exported ID</FieldLabel></FormField>
            <Button className="min-h-11" disabled={busy} type="submit">Save corrections</Button>
          </form>
          <form className="space-y-3 border-t pt-3" onSubmit={event => { event.preventDefault(); void update("search", { query }); }}>
            <Label htmlFor={`${prefix}-search`}>{metadata.type === "episode" ? "Search TMDB series" : "Search TMDB movies"}</Label><Input className="min-h-11" data-metadata-search disabled={busy} id={`${prefix}-search`} maxLength={200} onChange={event => setQuery(event.target.value)} required value={query} />
            <p className="text-sm text-muted-foreground">Requires an authorized TMDB token in Settings → Sources. {metadata.type === "episode" && "The season and episode numbers above select an episode from the chosen series."}</p>
            <Button className="min-h-11" disabled={busy} type="submit" variant="secondary">Search TMDB</Button>
          </form>
          {results && <ul aria-label="TMDB search results" className="space-y-2">{results.map(result => <li key={result.id}><Button className="h-auto min-h-11 w-full whitespace-normal text-left" disabled={busy} onClick={() => void update("preview", { revision: metadata.revision, id: result.id, season: draft.season === "" ? null : Number(draft.season), episode: draft.episode === "" ? null : Number(draft.episode) })} type="button" variant="outline">Preview {result.title} {result.year}</Button><p className="text-sm text-muted-foreground">{result.description}</p></li>)}{!results.length && <li>No matches. Try another title.</li>}</ul>}
          {preview && <div aria-label="TMDB match preview" className="space-y-3 rounded-md border p-3">
            <h4 className="font-medium">Preview: {preview.match.title}</h4>
            {preview.artwork && <img alt="TMDB preview artwork" className="max-h-52 max-w-full object-contain" src={preview.artwork} />}
            <dl className="space-y-2 text-sm">{(Object.keys(fields) as Field[]).filter(key => metadata.type === "episode" || !["showTitle", "season", "episode"].includes(key)).map(key => <div key={key}><dt className="text-muted-foreground">{fields[key]}</dt><dd className="break-words whitespace-pre-wrap">{Array.isArray(preview.values[key]) ? (preview.values[key] as string[]).join(", ") : preview.values[key] ?? "Empty"}</dd></div>)}</dl>
            <p className="text-sm">Applying replaces all previewed fields and artwork, including manual corrections. A missing preview image clears artwork. Preview expires at {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
            <Button className="min-h-11" disabled={busy} onClick={() => void update("match", { revision: metadata.revision, previewId: preview.id })} type="button">Apply this match</Button>
          </div>}
          <div className="space-y-2 border-t pt-3"><h4 className="font-medium">Export saved metadata</h4><p className="text-sm">{native ? "Choose where to save a TAR archive." : "Download a TAR archive to this browser's download destination."} It contains saved NFO, artwork and placement instructions. Unsaved edits are excluded. Review it before replacing any sidecars.</p><Button className="min-h-11" disabled={busy} onClick={() => void update("export", { revision: metadata.revision })} type="button" variant="outline">{native ? "Save metadata archive" : "Download saved metadata"}</Button></div>
        </>}
      </>}
    </section>
  );
}
