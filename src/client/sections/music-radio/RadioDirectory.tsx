import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Credentials } from "../../session/session";
import type { RadioStation } from "../../../shared/radio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioStationList } from "./RadioStationList";
import { searchRadioStations } from "@/api/radio";

type Props = {
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  favorites: RadioStation[];
  busyId: string | null;
  onPlay: (station: RadioStation) => void;
  onQueue: (station: RadioStation) => void;
  onFavorite: (station: RadioStation, saved: boolean) => void;
};

export function RadioDirectory({ credentials, connected, canPlay, favorites, busyId, onPlay, onQueue, onFavorite }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [country, setCountry] = useState("");
  const [results, setResults] = useState<RadioStation[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    request.current?.abort();
    setDraft(""); setCountry(""); setResults(null); setSearching(false); setError(null);
  }, [credentials.origin, credentials.token]);
  useEffect(() => () => request.current?.abort(), []);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const value = draft.trim();
    setSearching(true); setError(null);
    try {
      const stations = await searchRadioStations(credentials, value, country, controller.signal);
      if (!controller.signal.aborted) setResults(stations);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not search radio stations.");
    } finally { if (!controller.signal.aborted) setSearching(false); }
  };

  return <div className="space-y-4 border-t pt-5">
    <Button variant="outline" aria-expanded={open} aria-controls="radio-directory-content" data-back={open ? "" : undefined} onClick={() => setOpen(value => !value)}>Discover more stations<ChevronDown aria-hidden="true" className={open ? "rotate-180" : ""} /></Button>
    {open && <div id="radio-directory-content" className="space-y-4">
      <a className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4" href="https://www.radio-browser.info/" target="_blank" rel="noreferrer">Radio Browser directory</a>
      <form className="flex flex-wrap items-end gap-3" role="search" onSubmit={search}>
        <div className="min-w-0 flex-[1_1_180px] space-y-2"><Label htmlFor="radio-station-query">Station name</Label><Input id="radio-station-query" type="search" maxLength={100} placeholder="Station name or popular radio" value={draft} disabled={!connected} onChange={event => setDraft(event.target.value)} /></div>
        <div className="w-28 space-y-2"><Label htmlFor="radio-country">Country code</Label><Input id="radio-country" maxLength={2} pattern="[A-Za-z]{2}|" placeholder="Any" aria-description="Optional two-letter country code, for example IT or GB" value={country} disabled={!connected} onChange={event => setCountry(event.target.value.toUpperCase())} /></div>
        <Button disabled={!connected || searching}>{searching ? "Searching…" : "Find stations"}</Button>
      </form>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {results !== null && <div className="space-y-3"><h3 className="flex items-center gap-2 text-lg font-medium">Search results <Badge variant="secondary">{results.length}</Badge></h3>
        {results.length ? <RadioStationList stations={results} favorites={favorites} connected={connected} canPlay={canPlay} busyId={busyId} onPlay={onPlay} onQueue={onQueue} onFavorite={onFavorite} /> : <p className="text-sm text-muted-foreground">No stations found. Try a different name or country code.</p>}
      </div>}
    </div>}
  </div>;
}
