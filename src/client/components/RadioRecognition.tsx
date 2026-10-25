import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines } from "lucide-react";
import { identifyRadioSong } from "@/api/radio";
import type { ApiCredentials } from "@/api/client";
import { MediaArtwork } from "./MediaArtwork";
import { Button } from "./ui/button";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "./ui/item";
import { Spinner } from "./ui/spinner";
import type { RadioRecognitionResult } from "../../shared/radio-recognition";

export function RadioRecognition({ credentials, stationId, connected, controls }: {
  credentials: ApiCredentials; stationId: string; connected: boolean; controls: HTMLElement | null;
}) {
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RadioRecognitionResult | null>(null);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const cancelControl = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useLayoutEffect(() => {
    if (pending || !restoreFocus.current) return;
    restoreFocus.current = false;
    trigger.current?.focus();
  }, [pending]);

  // The player keys this component to the Couch, station and playback. Leaving it stops the request.
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useEffect(() => {
    if (connected) return;
    request.current?.abort();
    request.current = null;
    setPending(false);
    setResult(null);
    setError("");
  }, [connected]);

  async function identify() {
    if (!connected || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setResult(null);
    setError("");
    try {
      const found = await identifyRadioSong(credentials, stationId, controller.signal);
      if (request.current === controller && !controller.signal.aborted) setResult(found);
    } catch (reason) {
      if (request.current !== controller || controller.signal.aborted) return;
      if (reason instanceof Error && reason.name === "TimeoutError") setError("Identification took too long. Try again.");
      else setError(reason instanceof Error ? reason.message : "Couldn't identify the song. Try again.");
    } finally {
      if (request.current === controller) {
        restoreFocus.current = document.activeElement === cancelControl.current;
        request.current = null;
        setPending(false);
      }
    }
  }

  function cancel() {
    request.current?.abort();
    request.current = null;
    restoreFocus.current = true;
    setPending(false);
  }

  const track = result?.track;
  return <>
    {controls && createPortal(<div data-radio-recognition-controls className="flex items-center gap-0.5">
      <Button ref={trigger} variant="ghost" size="icon-lg" className="size-(--player-target)" aria-label={pending ? "Identifying…" : "Identify song"} title="Identify song" disabled={!connected || pending} onClick={() => void identify()}>
        {pending ? <Spinner aria-hidden="true" role="presentation" className="motion-reduce:animate-none" /> : <AudioLines aria-hidden="true" />}
      </Button>
      {pending && <Button ref={cancelControl} variant="ghost" size="sm" onClick={cancel}>Cancel</Button>}
    </div>, controls)}
    {(pending || result || error) && <div data-radio-recognition className="min-w-0 text-sm text-pretty" aria-busy={pending}>
      <div role="status" aria-live="polite" aria-atomic="true">
        {pending && <p className="text-muted-foreground">Identifying…</p>}
        {result && (track ? <Item size="sm" className="max-w-md flex-nowrap items-start gap-3 rounded-none border-0 p-0">
          <ItemMedia>
            <MediaArtwork thumbnail={track.artworkUrl} title={track.title} className="aspect-square size-16 rounded-sm object-contain" />
          </ItemMedia>
          <ItemContent className="min-w-0 gap-0.5">
            <ItemTitle className="line-clamp-none text-base break-words">{track.title}</ItemTitle>
            {track.artist && <ItemDescription className="line-clamp-none break-words text-foreground">{track.artist}</ItemDescription>}
            {track.album && <ItemDescription className="line-clamp-none break-words">{track.album}</ItemDescription>}
            <p className="mt-1 text-meta text-muted-foreground">Identified at <time dateTime={new Date(result.sampledAt).toISOString()}>{new Date(result.sampledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></p>
          </ItemContent>
        </Item> : <p className="text-muted-foreground">No song identified. Try another part of the stream.</p>)}
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>}
  </>;
}
