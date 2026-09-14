import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { RadioStation } from "../shared/radio";
import { AvoidRadioHome } from "./AvoidRadioHome";
import { PlaylistRadioPanel } from "./PlaylistRadioPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, Play, Plus, Star } from "lucide-react";

type Props = {
  origin: string;
  token: string;
  connected: boolean;
  host: boolean;
  onManage: () => void;
  canPlay: boolean;
  version: number;
  onEnqueue: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  active?: boolean;
  currentStationId?: string;
};

const message = (error: unknown) => error instanceof Error ? error.message : "The radio request failed.";

function StationArtwork({ station }: { station: RadioStation }) {
  const [failed, setFailed] = useState(false);
  let src = "";
  try {
    const url = new URL(station.logoUrl ?? "");
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) src = url.href;
  } catch { /* A missing or invalid logo uses the station initials. */ }
  return src && !failed
    ? <img className="radio-logo size-12 shrink-0 rounded-lg bg-muted object-contain" src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="radio-monogram grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-base font-semibold text-primary" aria-hidden="true">{station.name.slice(0, 2).toUpperCase()}</span>;
}

export function RadioPanel({ origin, token, connected, canPlay, version, onEnqueue, onManage, host, active = true, currentStationId }: Props) {
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [results, setResults] = useState<RadioStation[] | null>(null);
  const [favorites, setFavorites] = useState<RadioStation[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const searchRequest = useRef<AbortController | null>(null);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${origin}/api/radio/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "Could not complete the radio request.");
    }
    return response;
  }, [origin, token]);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void request("favorites", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then(response => response.json() as Promise<{ favorites: RadioStation[] }>)
      .then(body => { if (!controller.signal.aborted) setFavorites(body.favorites); })
      .catch(reason => { if (!controller.signal.aborted) setError(message(reason)); });
    return () => { controller.abort(); };
  }, [request, connected, version]);

  useEffect(() => {
    searchRequest.current?.abort();
    setResults(null); setFavorites([]); setQuery(""); setCountry(""); setError(null); setNotice(""); setSearching(false); setBusy(null);
  }, [origin, token]);

  useEffect(() => () => { searchRequest.current?.abort(); }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setError(null);
    setNotice("");
    try {
      const params = new URLSearchParams({ q: query.trim(), countrycode: country.trim() });
      const response = await request(`stations?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      const body = await response.json() as { stations: RadioStation[] };
      if (!controller.signal.aborted) setResults(body.stations);
    } catch (reason) {
      if (!controller.signal.aborted) setError(message(reason));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  async function favorite(station: RadioStation, saved: boolean) {
    setBusy(station.id);
    setError(null);
    try {
      await request(saved ? `favorites/${station.id}` : "favorites", { method: saved ? "DELETE" : "POST", body: saved ? undefined : JSON.stringify({ station }) });
      setNotice(`${station.name} ${saved ? "removed from" : "saved to"} favorites.`);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }

  async function enqueue(station: RadioStation, playNow = false) {
    setBusy(station.id);
    setError(null);
    try {
      if (await onEnqueue(station, playNow)) setNotice(playNow ? `Starting ${station.name}.` : `${station.name} added to queue.`);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }

  const cards = (stations: RadioStation[]) => <ul className="radio-grid">{stations.map(station => {
    const saved = favorites.some(favorite => favorite.id === station.id);
    return <li className="radio-station min-w-0" key={station.id}>
      <Card className="catalog-card h-full justify-between gap-3 p-3">
        <div className="radio-station-heading flex items-center gap-3"><StationArtwork key={station.logoUrl || station.id} station={station} /><div className="min-w-0"><h3 className="line-clamp-2 break-words text-base font-medium" title={station.name}>{station.name}</h3><p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{[station.groupTitle, station.countryCode, station.codec, station.bitrate ? `${station.bitrate} kbps` : ""].filter(Boolean).join(" · ") || "Internet radio"}</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><Button className="radio-play" disabled={!connected || !canPlay || busy !== null} aria-label={`Play now: ${station.name}`} onClick={() => void enqueue(station, true)}><Play aria-hidden="true" />Play now</Button><Button variant="secondary" className="secondary-button" aria-label={`Add to queue: ${station.name}`} disabled={!connected || busy !== null} onClick={() => void enqueue(station)}><Plus aria-hidden="true" />Add to queue</Button><Button variant={saved ? "secondary" : "ghost"} size="icon" className={`radio-favorite ${saved ? "saved" : ""}`} disabled={!connected || busy !== null} aria-label={`${saved ? "Remove" : "Save"} ${station.name} ${saved ? "from" : "to"} favorites`} aria-pressed={saved} onClick={() => void favorite(station, saved)}><Star aria-hidden="true" className={saved ? "fill-current" : ""} /></Button></div>
      </Card>
    </li>;
  })}</ul>;

  return <section className="radio-panel catalog-panel min-w-0 space-y-5" aria-labelledby="radio-title">
    <div className="radio-heading catalog-heading"><h2 id="radio-title" className="text-2xl font-semibold">Internet radio</h2><p className="mt-1 text-sm text-muted-foreground">Your stations, ready to play.</p></div>
    {error && <Alert variant="destructive" className="radio-error"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p className="radio-notice text-sm text-primary" role="status">{notice}</p>}
    {favorites.length > 0 && <div className="radio-group space-y-3"><h3 className="flex items-center gap-2 text-base font-medium">Favorites <Badge variant="secondary">{favorites.length}</Badge></h3>{cards(favorites)}</div>}
    <AvoidRadioHome origin={origin} token={token} connected={connected} canPlay={canPlay} version={version} onEnqueue={onEnqueue} active={active} currentStationId={currentStationId} />
    <PlaylistRadioPanel host={host} onManage={onManage} connected={connected} version={version} request={request} renderStations={cards} />
    {!favorites.length && <p className="radio-empty text-sm text-muted-foreground">Star a station to keep it at the top of your radio.</p>}
    <div className="radio-directory space-y-4 border-t pt-5">
      <Button variant="outline" aria-expanded={directoryOpen} aria-controls="radio-directory-content" data-back={directoryOpen ? "" : undefined} onClick={() => setDirectoryOpen(value => !value)}>Discover more stations<ChevronDown aria-hidden="true" className={directoryOpen ? "rotate-180" : ""} /></Button>
      {directoryOpen && <div id="radio-directory-content" className="space-y-4">
        <a className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4" href="https://www.radio-browser.info/" target="_blank" rel="noreferrer">Radio Browser directory</a>
        <form className="radio-search flex flex-wrap items-end gap-3" role="search" onSubmit={search}>
          <div className="min-w-0 flex-[1_1_180px] space-y-2"><Label htmlFor="radio-station-query">Station name</Label><Input id="radio-station-query" type="search" maxLength={100} placeholder="Station name or popular radio" value={query} disabled={!connected} onChange={event => setQuery(event.target.value)} /></div>
          <div className="radio-country w-28 space-y-2"><Label htmlFor="radio-country">Country code</Label><Input id="radio-country" maxLength={2} pattern="[A-Za-z]{2}|" placeholder="Any" aria-description="Optional two-letter country code, for example IT or GB" value={country} disabled={!connected} onChange={event => setCountry(event.target.value.toUpperCase())} /></div>
          <Button className="primary-button" disabled={!connected || searching}>{searching ? "Searching…" : "Find stations"}</Button>
        </form>
        {results !== null && <div className="radio-group space-y-3"><h3 className="flex items-center gap-2 text-lg font-medium">Search results <Badge variant="secondary">{results.length}</Badge></h3>{results.length ? cards(results) : <p className="radio-empty text-sm text-muted-foreground">No stations found. Try a different name or country code.</p>}</div>}
      </div>}
    </div>
  </section>;
}
