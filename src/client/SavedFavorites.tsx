import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Play, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProviderItem } from "../shared/providers";
import type { RadioStation } from "../shared/radio";
import { MediaArtwork } from "./ProviderPanel";
import type { Credentials } from "./session";

export type SavedFavoriteActions = {
  onEnqueueProvider: (item: ProviderItem, playNow: boolean) => Promise<boolean>;
  onEnqueueRadio: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  onOpenProvider: (item: ProviderItem) => void;
};
type Favorite = { kind: "provider"; item: ProviderItem } | { kind: "radio"; item: RadioStation };
const providers = { youtube: "YouTube", raiplay: "RaiPlay", twitch: "Twitch", bandcamp: "Bandcamp" };
const title = (favorite: Favorite) => favorite.kind === "provider" ? favorite.item.title : favorite.item.name;
const key = (favorite: Favorite) => `${favorite.kind}:${favorite.item.id}`;
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Could not use this saved item.";

export function SavedFavorites({ origin, token, connected, canPlay, providerVersion, radioVersion, onEnqueueProvider, onEnqueueRadio, onOpenProvider }: Credentials & SavedFavoriteActions & {
  connected: boolean; canPlay: boolean; providerVersion: number; radioVersion: number;
}) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setFavorites([]); setNotice(""); setError(""); setActionError(""); setPending(false); return () => mutation.current?.abort(); }, [origin, token, connected]);
  useEffect(() => {
    if (!connected) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    const read = async (source: "providers" | "radio") => {
      const response = await fetch(`${origin}/api/${source}/favorites`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Could not load saved ${source === "radio" ? "stations" : "online items"}.`);
      return body.favorites;
    };
    void Promise.allSettled([read("providers"), read("radio")]).then(([online, radio]) => {
      if (controller.signal.aborted) return;
      setFavorites([
        ...(online.status === "fulfilled" ? online.value.map((item: ProviderItem): Favorite => ({ kind: "provider", item })) : []),
        ...(radio.status === "fulfilled" ? radio.value.map((item: RadioStation): Favorite => ({ kind: "radio", item })) : []),
      ].sort((a, b) => title(a).localeCompare(title(b))));
      setError([online, radio].flatMap(result => result.status === "rejected" ? [message(result.reason)] : []).join(" "));
      setLoading(false);
    });
    return () => controller.abort();
  }, [origin, token, connected, providerVersion, radioVersion, refresh]);

  const update = async (favorite: Favorite, action: "play" | "append" | "remove") => {
    if (!connected || mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true); setActionError(""); setNotice("");
    try {
      if (action === "remove") {
        const response = await fetch(`${origin}/api/${favorite.kind === "provider" ? "providers" : "radio"}/favorites/${encodeURIComponent(favorite.item.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Could not remove this saved item."); }
        if (controller.signal.aborted) return;
        const index = favorites.findIndex(item => key(item) === key(favorite));
        setFavorites(current => current.filter(item => key(item) !== key(favorite)));
        setNotice(`Removed ${title(favorite)} from Saved.`);
        requestAnimationFrame(() => {
          const rows = list.current?.children;
          (rows?.[Math.min(index, rows.length - 1)]?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? heading.current)?.focus();
        });
      } else {
        const ok = await (favorite.kind === "provider" ? onEnqueueProvider(favorite.item, action === "play") : onEnqueueRadio(favorite.item, action === "play"));
        if (!controller.signal.aborted && ok) setNotice(action === "play" ? `Starting ${title(favorite)} on the TV.` : `Added ${title(favorite)} to Up next.`);
      }
    } catch (reason) { if (!controller.signal.aborted) setActionError(message(reason)); }
    finally { if (!controller.signal.aborted) setPending(false); if (mutation.current === controller) mutation.current = null; }
  };
  return <section className="saved-favorites space-y-3" aria-labelledby="saved-favorites-heading">
    <h2 ref={heading} id="saved-favorites-heading" tabIndex={-1} className="text-xl font-semibold">Online and radio</h2>
    {!connected && <p role="status">Reconnect to see saved online items and stations.</p>}
    {loading && <p role="status">Loading saved items…</p>}
    {error && <div role="alert"><p>{error}</p><Button variant="outline" disabled={!connected || loading || pending} onClick={() => setRefresh(value => value + 1)}>Retry saved items</Button></div>}
    {actionError && <p role="alert">{actionError}</p>}
    {notice && <p role="status">{notice}</p>}
    {connected && !loading && !error && !favorites.length && <p className="text-sm text-muted-foreground">Save a video, album, channel or station from Search or Browse to find it here.</p>}
    <ul ref={list} className="saved-favorite-items" aria-label="Saved online items and stations" aria-busy={loading}>{favorites.map(favorite => {
      const itemTitle = title(favorite);
      const browse = favorite.kind === "provider" && favorite.item.kind !== "media";
      const detail = favorite.kind === "provider" ? [providers[favorite.item.provider], favorite.item.kind === "media" ? favorite.item.live ? "Live" : favorite.item.provider === "bandcamp" ? "Track" : "Video" : favorite.item.kind === "channel" ? "Channel" : "Collection", favorite.item.subtitle].filter(Boolean).join(" · ") : ["Radio", favorite.item.groupTitle || favorite.item.countryCode].filter(Boolean).join(" · ");
      return <li key={key(favorite)} className="saved-favorite-row">
        <MediaArtwork key={(favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl) || favorite.item.id} thumbnail={favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl} title={itemTitle} className="saved-item-art" />
        <div className="saved-favorite-title"><strong>{itemTitle}</strong><small>{detail}</small></div>
        <div className="saved-item-actions">
          {browse && favorite.kind === "provider" ? <Button disabled={!connected || pending} aria-label={`Open ${itemTitle}`} onClick={() => onOpenProvider(favorite.item)}><ArrowUpRight aria-hidden="true" />Open</Button> : <>
            <Button disabled={!connected || !canPlay || pending} aria-label={`Play ${itemTitle}`} onClick={() => void update(favorite, "play")}><Play aria-hidden="true" />Play</Button>
            <Button variant="outline" disabled={!connected || pending} aria-label={`Add ${itemTitle} to Up next`} onClick={() => void update(favorite, "append")}><Plus aria-hidden="true" />Up next</Button>
          </>}
          <Button variant="ghost" disabled={!connected || pending} aria-label={`Remove ${itemTitle} from Saved`} onClick={() => void update(favorite, "remove")}><X aria-hidden="true" />Remove</Button>
        </div>
      </li>;
    })}</ul>
  </section>;
}
