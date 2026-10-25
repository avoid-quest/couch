import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { identifyRadioSong, radioRecognitionsQuery } from "@/api/radio";
import type { ApiCredentials } from "@/api/client";
import { RadioRecognitionItem } from "./RadioRecognitionItem";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import type { RadioRecognitionEntry } from "../../shared/radio-recognition";

export function RadioRecognition({ credentials, stationId, connected, controls }: {
  credentials: ApiCredentials; stationId: string; connected: boolean; controls: HTMLElement | null;
}) {
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RadioRecognitionEntry | null>(null);
  const client = useQueryClient();
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
      if (request.current === controller && !controller.signal.aborted) {
        setResult(found);
        void client.invalidateQueries({ queryKey: radioRecognitionsQuery(credentials).queryKey });
      }
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

  function clearResult() {
    setResult(null);
    setError("");
    trigger.current?.focus();
  }

  return <>
    {controls && createPortal(<div data-radio-recognition-controls className="flex items-center gap-0.5">
      <Button ref={trigger} variant="ghost" size="icon-lg" className="size-(--player-target)" aria-label={pending ? "Identifying…" : "Identify song"} title="Identify song" disabled={!connected || pending} onClick={() => void identify()}>
        {pending ? <Spinner aria-hidden="true" role="presentation" className="motion-reduce:animate-none" /> : <AudioLines aria-hidden="true" />}
      </Button>
      {pending && <Button ref={cancelControl} variant="ghost" size="sm" onClick={cancel}>Cancel</Button>}
    </div>, controls)}
    {(pending || result || error) && <div data-radio-recognition className="my-3 grid max-w-md min-w-0 gap-2 text-sm text-pretty" aria-busy={pending}>
      <div className={result?.track ? "sr-only" : "flex min-w-0 items-center gap-3"}>
        <div className="min-w-0 flex-1">
          <div role="status" aria-live="polite" aria-atomic="true">
            {pending && <p className="text-muted-foreground">Identifying…</p>}
            {result && (result.track ? `${result.track.title}${result.track.artist ? `, ${result.track.artist}` : ""}` : "No song identified. Try another part of the stream.")}
          </div>
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
        {(error || result && !result.track) && <Button variant="ghost" size="icon-sm" aria-label="Clear result" title="Clear result" onClick={clearResult}><X aria-hidden="true" /></Button>}
      </div>
      {result?.track && <RadioRecognitionItem entry={result} onDismiss={clearResult} />}
    </div>}
  </>;
}
