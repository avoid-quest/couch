import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CompressorControls } from "@/components/CompressorControls";
import { deviceId } from "@/session/device-id";
import type { ClientSessionState } from "@/session/session";
import type { Row } from "@/session/where-it-plays";
import { membersOf } from "@/session/groups";
import type { Action } from "../../../shared/protocol";
import { useCanSave, useGroupEdit } from "./MixerGroups";

/**
 * Advanced, at the open list's end: In sync for a captured picture, the Compressor with its settings, and Save as group
 * for the host and administrators, which names what plays now as a group.
 */
export function Advanced({
  state,
  connected,
  run,
  inSync,
  rows,
}: {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  inSync?: boolean;
  rows: Row[];
}) {
  const [open, setOpen] = useState(false);
  const edit = useGroupEdit();
  const canSave = useCanSave() && !!edit;
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const compressor = !!state.compressor && !!state.player.playbackId;
  if (inSync === undefined && !compressor && !canSave) return null;
  // A playback another device plays privately keeps its sound as that device set it.
  const canCompress =
    !state.outputs?.length ||
    state.outputs.some((output) => {
      const sharing = state.devices?.find((device) => device.id === output.deviceId)?.sharing;
      return (
        output.deviceId === deviceId() ||
        ((!output.picture || sharing?.video) && (!output.sound || sharing?.audio))
      );
    });
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <div className="mt-2 border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between rounded-b-md text-meta font-medium text-muted-foreground outline-none hover:text-foreground"
      >
        Advanced
        <Chevron aria-hidden="true" className="size-4" />
      </button>
      {open && (
        <div className="grid gap-1 pb-1">
          {inSync !== undefined && (
            <div data-nav-row className="flex min-h-13 items-center gap-3">
              <Label htmlFor="where-it-plays-in-sync" className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-normal">In sync</span>
                <span className="text-caption font-normal text-subtle-foreground">
                  Every device plays together, a few seconds behind.
                </span>
              </Label>
              <Switch
                id="where-it-plays-in-sync"
                checked={inSync}
                disabled={!connected}
                onCheckedChange={(on) => void run({ type: "inSync", inSync: on })}
              />
            </div>
          )}
          {compressor && (
            <CompressorControls
              key={state.playback}
              settings={state.compressor!}
              playbackId={state.player.playbackId!}
              run={run}
              unavailable={
                !connected
                  ? "Reconnect to change the compressor."
                  : !canCompress
                    ? "This playback is private."
                    : current?.liveSourceId
                      ? "Unavailable for live sharing."
                      : undefined
              }
            />
          )}
          {canSave && (
            <div data-nav-row className="flex min-h-13 items-center gap-3">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm">Groups</span>
                <span className="text-caption text-subtle-foreground">
                  Saved by the host and administrators, for everyone.
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!connected}
                onClick={() => edit({ name: "", members: membersOf(rows) })}
              >
                Save as group
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
