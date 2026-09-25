import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CollectionDefinition, CollectionFilter, CollectionSort } from "../../shared/collections";
import type { LibrarySearch } from "../../shared/library";

export function CollectionChoice({ label, value, choices, disabled, onChange }: { label: string; value: string; choices: [string, string][]; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="grid min-w-0 gap-2"><Label>{label}</Label><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className="min-h-11 w-full" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{choices.map(([key, title]) => <SelectItem key={key} value={key}>{title}</SelectItem>)}</SelectContent></Select></div>;
}

export function CollectionEditor({ value, onChange, disabled, origin, token, version }: { value: CollectionDefinition; onChange: (value: CollectionDefinition) => void; disabled: boolean; origin: string; token: string; version: number }) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<LibrarySearch | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (disabled || value.filter) return;
    const controller = new AbortController();
    setResults(null);
    void fetch(`${origin}/api/library/items?${new URLSearchParams({ q: query, videoType: "movie", offset: String(offset), limit: "30" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not search movies."); if (!controller.signal.aborted) { setResults(data); setError(null); } })
      .catch(reason => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [origin, token, query, offset, disabled, !!value.filter, version]);
  const update = (patch: Partial<CollectionDefinition>) => onChange({ ...value, ...patch });
  const move = (index: number, direction: number) => { const members = [...value.members]; const [item] = members.splice(index, 1); members.splice(index + direction, 0, item!); update({ members }); };
  const filterField = (field: keyof Omit<CollectionFilter, "kind">, raw: string) => {
    const filter = { ...value.filter! };
    if (!raw) delete filter[field];
    else if (field === "year") filter.year = Number(raw);
    else filter[field] = raw;
    update({ filter });
  };
  const music = value.filter?.kind === "audio";
  return <div className="grid gap-4" aria-label="Collection definition">
    <div className="grid gap-2"><Label htmlFor="collection-name">Name</Label><Input autoFocus id="collection-name" value={value.name} maxLength={80} disabled={disabled} onChange={event => update({ name: event.target.value })} /></div>
    <CollectionChoice label="Collection type" value={value.filter?.kind ?? "manual"} choices={[["manual", "Manual film collection"], ["movie", "Movie filter"], ["episode", "Show episode filter"], ["audio", "Music filter"]]} disabled={disabled} onChange={kind => update({ filter: kind === "manual" ? null : { kind: kind as CollectionFilter["kind"] }, members: [], sort: kind === "manual" ? "manual" : "title", descending: false })} />
    <div className="grid gap-3 sm:grid-cols-2">
      <CollectionChoice label="Sort order" value={value.sort} choices={[...(!value.filter ? [["manual", "My order"] as [string, string]] : []), ["title", "Title"], ...(music ? [["album", "Album, disc and track"] as [string, string]] : [["year", "Year, then title"] as [string, string]])]} disabled={disabled} onChange={sort => update({ sort: sort as CollectionSort })} />
      <CollectionChoice label="Direction" value={value.descending ? "descending" : "ascending"} choices={[["ascending", "Ascending"], ["descending", "Descending"]]} disabled={disabled} onChange={direction => update({ descending: direction === "descending" })} />
    </div>
    {value.filter ? <>
      <p className="text-sm text-muted-foreground">All filled fields must match. Text fields contain the words you enter. The preview shows the first 500 matches in your chosen order.</p>
      <div className="grid gap-3 sm:grid-cols-2">{(["title", ...(music ? ["artist", "album"] : ["year", "genre", ...(value.filter.kind === "episode" ? ["show"] : [])])] as Array<keyof Omit<CollectionFilter, "kind">>).map(field => <div key={field} className="grid gap-2"><Label htmlFor={`collection-${field}`}>{field === "show" ? "Show title" : field[0]!.toUpperCase() + field.slice(1)}</Label><Input id={`collection-${field}`} type={field === "year" ? "number" : "text"} min={field === "year" ? 1 : undefined} max={field === "year" ? 9999 : undefined} maxLength={200} value={value.filter![field] ?? ""} disabled={disabled} onChange={event => filterField(field, event.target.value)} /></div>)}</div>
    </> : <>
      <p className="text-sm text-muted-foreground">{value.members.length} of 500 movies. Add movies below, then save to preview availability.</p>
      <ol className="max-h-72 divide-y overflow-y-auto" aria-label="Collection members">{value.members.map((member, index) => <li key={member.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 break-words text-sm">{index + 1}. {member.title}</span><div className="flex gap-1">
        <Button variant="ghost" size="icon" aria-label={`Move ${member.title} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
        <Button variant="ghost" size="icon" aria-label={`Move ${member.title} down`} disabled={disabled || index === value.members.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
        <Button variant="ghost" size="icon" aria-label={`Remove ${member.title}`} disabled={disabled} onClick={() => update({ members: value.members.filter(item => item.id !== member.id) })}><X /></Button>
      </div></li>)}</ol>
      <div className="flex gap-2"><Input aria-label="Find movies for collection" placeholder="Find movies" value={draft} maxLength={200} disabled={disabled} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); setQuery(draft.trim()); setOffset(0); } }} /><Button variant="outline" aria-label="Search movies for collection" disabled={disabled} onClick={() => { setQuery(draft.trim()); setOffset(0); }}><Search /></Button></div>
      {error && <p role="alert">{error}</p>}
      <ul className="max-h-72 divide-y overflow-y-auto" aria-label="Movies to add">{results?.items.map(item => <li key={item.id}><Button variant="ghost" className="h-auto min-h-11 w-full justify-start rounded-none px-0 py-2 text-left whitespace-normal" disabled={disabled || value.members.length >= 500 || value.members.some(member => member.id === item.id)} onClick={() => update({ members: [...value.members, { id: item.id, title: item.title }] })}><Plus /><span className="min-w-0 break-words">{item.title}{!item.available && " · Missing"}</span></Button></li>)}</ul>
      {results && results.total > 30 && <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={disabled || offset === 0} onClick={() => setOffset(offset - 30)}>Previous movies</Button><span className="text-sm">{offset + 1}–{Math.min(offset + 30, results.total)} of {results.total}</span><Button variant="outline" disabled={disabled || offset + 30 >= results.total} onClick={() => setOffset(offset + 30)}>Next movies</Button></div>}
    </>}
  </div>;
}
