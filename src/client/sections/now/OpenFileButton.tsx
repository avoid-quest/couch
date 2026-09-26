import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Action } from "../../../shared/protocol";
import { createId } from "../../session/session";

// Local files use the native picker but still enqueue through the session.
export function OpenFileButton({ connected, run, playNow = false }: { connected: boolean; run: (action: Action) => Promise<boolean>; playNow?: boolean }) {
  const [choosing, setChoosing] = useState(false);
  const chooseFile = async () => {
    if (!connected || choosing) return;
    setChoosing(true);
    try {
      const file = await invoke<{ source: string; title: string } | null>("choose_media");
      if (file && !await run({ type: "enqueue", entry: { id: createId(), ...file }, playNow })) toast.error("Couldn't add file. Try again.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Couldn't open file.");
    } finally {
      setChoosing(false);
    }
  };
  return <Button variant="secondary" data-tv-local-only disabled={!connected || choosing} onClick={() => void chooseFile()}>
    <FolderOpen aria-hidden="true" />{choosing ? "Opening…" : "Open file"}
  </Button>;
}
