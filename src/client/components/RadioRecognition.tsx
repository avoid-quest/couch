import { useEffect, useRef, useState } from "react";
import { AudioLines } from "lucide-react";
import { identifyRadioSong } from "@/api/radio";
import type { ApiCredentials } from "@/api/client";
import { originalPageUrl } from "@/original-page";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import type { RadioRecognitionResult } from "../../shared/radio-recognition";

export function RadioRecognition({ credentials, stationId, connected }: {
  credentials: ApiCredentials; stationId: string; connected: boolean;
}) {
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RadioRecognitionResult | null>(null);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const cancelControl = useRef<HTMLButtonElement>(null);

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
      if (request.current === controller && !controller.signal.aborted) setError(reason instanceof Error && reason.name === "TimeoutError" ? "Identification took too long. Try again." : reason instanceof Error ? reason.message : "Couldn't identify the song. Try again.");
    } finally {
      if (request.current === controller) {
        const restoreFocus = document.activeElement === cancelControl.current;
        request.current = null;
        setPending(false);
        if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
      }
    }
  }

  function cancel() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    // The Cancel button disappears; keep keyboard and TV focus on the action that remains.
    requestAnimationFrame(() => trigger.current?.focus());
  }

  const track = result?.track;
  const url = originalPageUrl(track?.url);
  const shazamUrl = url && ["shazam.com", "www.shazam.com"].includes(new URL(url).hostname) ? url : undefined;
  return <div data-radio-recognition className="grid justify-items-start gap-2" aria-busy={pending}>
    <div className="flex flex-wrap items-center gap-2">
      <Button ref={trigger} variant="secondary" size="sm" disabled={!connected || pending} onClick={() => void identify()}>
        {pending ? <Spinner aria-hidden="true" role="presentation" className="motion-reduce:animate-none" /> : <AudioLines aria-hidden="true" />}
        {pending ? "Identifying…" : "Identify song"}
      </Button>
      {pending && <Button ref={cancelControl} variant="ghost" size="sm" onClick={cancel}>Cancel</Button>}
    </div>
    <div role="status" aria-live="polite" aria-atomic="true" className="grid gap-1 text-sm text-pretty">
      {result && (track ? <>
        <p>{[track.artist, track.title].filter(Boolean).join(" — ")}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          <span>Identified at <time dateTime={new Date(result.sampledAt).toISOString()}>{new Date(result.sampledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
          {shazamUrl && <a data-text-link data-tv-local-only href={shazamUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground">Open in Shazam<span className="sr-only"> (opens in a new tab)</span></a>}
        </p>
      </> : <p className="text-muted-foreground">No song identified. Try another part of the stream.</p>)}
    </div>
    {error && <p role="alert" className="text-sm text-pretty text-destructive">{error}</p>}
  </div>;
}
