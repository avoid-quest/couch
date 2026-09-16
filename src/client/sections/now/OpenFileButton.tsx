import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Action } from "../../../shared/protocol";
import { createId } from "../../session/session";

// Local files use the native picker but still enqueue through the session.
export function OpenFileButton({ connected, run }: { connected: boolean; run: (action: Action) => Promise<boolean> }) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async () => {
    if (!connected || choosing) return;
    setChoosing(true);
    setError(null);
    try {
      const file = await invoke<{ source: string; title: string } | null>("choose_media");
      if (file && !await run({ type: "enqueue", entry: { id: createId(), ...file } })) setError("Could not add this file. Try again when connected.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open this file.");
    } finally {
      setChoosing(false);
    }
  };

  return <>
    <Button variant="secondary" data-tv-local-only className="min-h-11" disabled={!connected || choosing} onClick={() => void chooseFile()}>
      <FolderOpen aria-hidden="true" />{choosing ? "Opening…" : "Open file"}
    </Button>
    {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
  </>;
}
