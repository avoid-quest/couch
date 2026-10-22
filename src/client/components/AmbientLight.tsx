import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject, type SyntheticEvent } from "react";
import { cachedArt, readArt, type Art, type Light, type Rgb } from "@/artwork-light";
import { SessionGateContext } from "@/session/gate-context";
import { cn } from "@/lib/utils";

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

type Frame = { id: number; light: Light | null; leaving: boolean; still: boolean };

/**
 * The picture's own box: the frame's image or video, and where that contains its picture (a letterboxed video, artwork
 * set down in a taller box), the picture inside it at its object-position; else the frame's box.
 */
function pictureBox(frame: HTMLElement) {
  const element = frame.querySelector("video, img") ?? frame, box = element.getBoundingClientRect();
  const width = element instanceof HTMLVideoElement ? element.videoWidth : element instanceof HTMLImageElement ? element.naturalWidth : 0;
  const height = element instanceof HTMLVideoElement ? element.videoHeight : element instanceof HTMLImageElement ? element.naturalHeight : 0;
  const style = getComputedStyle(element);
  if (!width || !height || style.objectFit !== "contain") return box;
  const scale = Math.min(box.width / width, box.height / height), shown = { width: width * scale, height: height * scale };
  const [x = "50%", y = "50%"] = style.objectPosition.split(" ");
  const offset = (value: string, room: number) => value.endsWith("%") ? room * parseFloat(value) / 100 : parseFloat(value) || 0;
  return new DOMRect(box.left + offset(x, box.width - shown.width), box.top + offset(y, box.height - shown.height), shown.width, shown.height);
}

/**
 * Light from the artwork on screen, behind it (docs/design.md, Light): a backlight in its first colour that hugs
 * the picture's edges and a wide haze in its second, both dark enough that the ink over them keeps 7:1. It lies in
 * its positioned parent, before the content, and never moves or sizes anything. When the artwork changes it
 * cross-fades over 600 ms, Couch's one slow move; reduced motion swaps it at once. `anchor` frames the picture: an image,
 * or a video, whose contained picture it lights around.
 */
export function AmbientLight({ src, anchor, className }: { src?: string; anchor: RefObject<HTMLElement | null>; className?: string }) {
  const light = useArtworkLight(src);
  const layer = useRef<HTMLDivElement>(null);
  // What shows: the current light last, and the ones it replaces until their fade ends. Light this page already read
  // (a revisit) is there at once, as its artwork is.
  const count = useRef(0);
  const [frames, setFrames] = useState<Frame[]>(() => light ? [{ id: count.current++, light, leaving: false, still: true }] : []);
  useEffect(() => {
    setFrames(shown => shown.length && shown.at(-1)!.light?.key === light?.key ? shown
      : [...shown.map(frame => ({ ...frame, leaving: true })), { id: count.current++, light, leaving: false, still: false }]);
    const done = setTimeout(() => setFrames(shown => shown.filter(frame => !frame.leaving)), 600);
    return () => clearTimeout(done);
  }, [light?.key]);
  const lit = frames.some(frame => frame.light);
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element || !lit) return;
    const place = () => {
      if (!anchor.current) return;
      const box = pictureBox(anchor.current), origin = element.getBoundingClientRect();
      // A picture that isn't on screen (Up next over it on a phone) lights nothing.
      element.hidden = !box.width || !box.height;
      element.style.setProperty("--light-x", `${Math.round(box.left - origin.left)}px`);
      element.style.setProperty("--light-y", `${Math.round(box.top - origin.top)}px`);
      element.style.setProperty("--light-w", `${Math.round(box.width)}px`);
      element.style.setProperty("--light-h", `${Math.round(box.height)}px`);
    };
    // The picture moves when anything around it changes size (a title that wraps), so the light watches the picture
    // and each box from it up to the light's own parent.
    const observer = new ResizeObserver(place);
    const frame = anchor.current;
    observer.observe(element);
    for (let box = frame; box && box !== element.parentElement?.parentElement; box = box.parentElement) observer.observe(box);
    // An image that loads or a video whose picture changes shape doesn't resize its frame; their events don't bubble,
    // but they pass the frame on their way down.
    const events = ["load", "resize", "loadedmetadata"];
    for (const name of events) frame?.addEventListener(name, place, true);
    place();
    return () => { observer.disconnect(); for (const name of events) frame?.removeEventListener(name, place, true); };
  }, [lit, anchor, src]);
  if (!lit) return null;
  return <div ref={layer} aria-hidden="true" className={cn("ambient-light", className)}>
    {frames.map(({ id, light, leaving, still }) => light && <div key={id} data-leaving={leaving || undefined} data-still={still || undefined} className="ambient-frame"
      style={{ "--light-a": `rgb(${light.a.join(" ")})`, "--light-b": `rgb(${light.b.join(" ")})` } as CSSProperties}>
      <div className="ambient-haze" /><div className="ambient-backlight" />
    </div>)}
  </div>;
}
