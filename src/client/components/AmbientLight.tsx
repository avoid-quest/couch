import { useContext, useEffect, useState, type CSSProperties, type SyntheticEvent } from "react";
import { cachedArt, readArt, type Art, type Light, type Rgb } from "@/artwork-light";
import { SessionGateContext } from "@/session/gate-context";

/** What was read of the artwork at `src` (its light, its edges), at once when this page has read it before; null while reading or unreadable. */
export function useArtwork(src: string | undefined) {
  const credentials = useContext(SessionGateContext)?.credentials;
  const usable = !!src && /^(https?|blob):/.test(src);
  const [art, setArt] = useState<Art | null>(() => usable ? cachedArt(src) : null);
  useEffect(() => {
    if (!usable) { setArt(null); return; }
    // The last light stays until the next is read, so the room cross-fades from one to the other.
    let live = true;
    void readArt(src, credentials).then(value => { if (live) setArt(value); });
    return () => { live = false; };
  }, [src, usable]);
  return art;
}

/** The light of the artwork at `src`, at once when this page has read it before; null while reading or without any. */
export const useArtworkLight = (src: string | undefined): Light | null => useArtwork(src)?.light ?? null;

const rgb = (colour: Rgb) => `rgb(${colour.join(" ")})`;
/** The room's colours and the light behind its picture as custom properties (index.css, .room); none keeps the neutral room. */
export const roomStyle = (light: Light | null | undefined) => light ? { "--room-a": rgb(light.room), "--room-b": rgb(light.deep), "--light-a": rgb(light.a), "--light-b": rgb(light.b), "--tone": rgb(light.tone) } as CSSProperties : undefined;

/**
 * A tile's or a row's light (Design → Hover), read the first time a pointer or focus reaches it: `--item-light`, the
 * artwork's first colour, which index.css lets glow under the picture while it is hovered or focused. `thumbnail` is
 * the address, or finds it in the item (a row's artwork is its caller's node). The colour is set on the item itself,
 * not through React state, so a hover never renders the item (and its menu) again; a picture read before lights at once.
 */
export function useItemLight(thumbnail?: string | ((item: HTMLElement) => string | undefined)) {
  const credentials = useContext(SessionGateContext)?.credentials;
  const ask = (event: SyntheticEvent<HTMLElement>) => {
    const item = event.currentTarget, src = typeof thumbnail === "function" ? thumbnail(item) : thumbnail;
    // No picture now (a row's image failed to its cover): no light, not the last picture's.
    if (!src || !/^(https?|blob):/.test(src)) { delete item.dataset.itemLight; item.style.removeProperty("--item-light"); return; }
    // Lit already for this picture, or reading it; a read that failed is tried again on the next hover.
    if (item.dataset.itemLight === src) return;
    item.dataset.itemLight = src;
    const paint = (art: Art | null) => {
      // An item showing another picture by the time this one is read keeps its own.
      if (item.dataset.itemLight !== src) return;
      if (!art) delete item.dataset.itemLight;
      if (art?.light) item.style.setProperty("--item-light", rgb(art.light.a)); else item.style.removeProperty("--item-light");
    };
    const known = cachedArt(src);
    if (known) paint(known); else { item.style.removeProperty("--item-light"); void readArt(src, credentials).then(paint); }
  };
  return { onPointerEnter: ask, onFocus: ask };
}
