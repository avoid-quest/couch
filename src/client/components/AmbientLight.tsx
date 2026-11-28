import {
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { artworkBytes, cachedArt, readArt, type Art, type Light, type Rgb } from "@/artwork-light";
import { SessionGateContext } from "@/session/gate-context";

/** What was read of the artwork at `src` (its light, its edges), at once when this page has read it before; null while reading or unreadable. */
export function useArtwork(src: string | undefined) {
  const credentials = useContext(SessionGateContext)?.credentials;
  const usable = !!src && /^(https?|blob):/.test(src);
  const [art, setArt] = useState<Art | null>(() => (usable ? cachedArt(src) : null));
  useEffect(() => {
    if (!usable) {
      setArt(null);
      return;
    }
    // The last light stays until the next is read, so the room cross-fades from one to the other.
    let live = true;
    void readArt(src, credentials).then((value) => {
      if (live) setArt(value);
    });
    return () => {
      live = false;
    };
  }, [src, usable]);
  return art;
}

/** The light of the artwork at `src`, at once when this page has read it before; null while reading or without any. */
export const useArtworkLight = (src: string | undefined): Light | null =>
  useArtwork(src)?.light ?? null;

/**
 * The artwork at `src` as Core serves it, for an image to show: a phone or a browser can be refused a host's picture
 * (RaiPlay's) that Core reads. Undefined while loading, or when it can't be had.
 */
export function useArtworkPicture(src: string | undefined) {
  const credentials = useContext(SessionGateContext)?.credentials;
  const [picture, setPicture] = useState<{ src: string; url: string }>();
  useEffect(() => {
    if (!src) return;
    let live = true,
      url: string | undefined;
    void artworkBytes(src, credentials).then(
      (bytes) => {
        if (!live) return;
        url = URL.createObjectURL(bytes);
        setPicture({ src, url });
      },
      () => {},
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);
  return picture && picture.src === src ? picture.url : undefined;
}

const rgb = (colour: Rgb) => `rgb(${colour.join(" ")})`;
/**
 * The room's lamps as custom properties (index.css, Room): the picture's two colours and how lit the room is, 0 to 1.
 * A picture without light leaves the room dark.
 */
export const roomStyle = (light: Light | null, level: number) =>
  ({
    "--light": light ? level : 0,
    ...(light && { "--lamp": rgb(light.lamp), "--spill": rgb(light.spill) }),
  }) as CSSProperties;

// The picture a page leads with (a Stage), which lights the room a little while nothing plays (RoomLight.tsx).
let lead: string | undefined;
const leadListeners = new Set<() => void>();
const setLead = (src: string | undefined) => {
  lead = src;
  for (const listener of leadListeners) listener();
};
/** Offers `src` as the page's lead picture while the caller is shown. */
export function useRoomLead(src: string | undefined) {
  useEffect(() => {
    if (!src) return;
    setLead(src);
    return () => {
      if (lead === src) setLead(undefined);
    };
  }, [src]);
}
/** The picture the page leads with, if it offers one. */
export const useLeadPicture = () =>
  useSyncExternalStore(
    (listener) => {
      leadListeners.add(listener);
      return () => leadListeners.delete(listener);
    },
    () => lead,
  );

/**
 * A tile's or a row's light (Design → Hover), read the first time a pointer or focus reaches it: `--item-light`, the
 * artwork's first colour, which index.css lets glow under the picture while it is hovered or focused. `thumbnail` is
 * the address, or finds it in the item (a row's artwork is its caller's node). The colour is set on the item itself,
 * not through React state, so a hover never renders the item (and its menu) again; a picture read before lights at once.
 */
export function useItemLight(thumbnail?: string | ((item: HTMLElement) => string | undefined)) {
  const credentials = useContext(SessionGateContext)?.credentials;
  const ask = (event: SyntheticEvent<HTMLElement>) => {
    const item = event.currentTarget,
      src = typeof thumbnail === "function" ? thumbnail(item) : thumbnail;
    // No picture now (a row's image failed to its cover): no light, not the last picture's.
    if (!src || !/^(https?|blob):/.test(src)) {
      delete item.dataset.itemLight;
      item.style.removeProperty("--item-light");
      return;
    }
    // Lit already for this picture, or reading it; a read that failed is tried again on the next hover.
    if (item.dataset.itemLight === src) return;
    item.dataset.itemLight = src;
    const paint = (art: Art | null) => {
      // An item showing another picture by the time this one is read keeps its own.
      if (item.dataset.itemLight !== src) return;
      if (!art) delete item.dataset.itemLight;
      if (art?.light) item.style.setProperty("--item-light", rgb(art.light.a));
      else item.style.removeProperty("--item-light");
    };
    const known = cachedArt(src);
    if (known) paint(known);
    else {
      item.style.removeProperty("--item-light");
      void readArt(src, credentials).then(paint);
    }
  };
  return { onPointerEnter: ask, onFocus: ask };
}
