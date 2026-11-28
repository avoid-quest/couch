import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import type { MenuAction } from "@/components/RowMenu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientSessionState, Credentials } from "@/session/session";
import type { Action } from "../../../shared/protocol";

/**
 * Up next's own menu, wherever Up next shows (the player's panel, Home's section): Save as list…, Clear Up next (undone
 * from its toast) and, where Autoplay has something to continue, Turn Autoplay off or on. `dialog` is Save as list's
 * dialog, which gives the focus back to `options` (the "…" that opened it); `onClear` places the focus before Up next
 * empties.
 */
export function useUpNextMenu({
  state,
  credentials,
  connected,
  run,
  upcoming,
  options,
  onClear,
}: {
  state: ClientSessionState | null;
  credentials: Credentials;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  upcoming: number;
  options: () => HTMLElement | null | undefined;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const keep = useMutation({
    mutationFn: (name: string) =>
      apiSend(credentials, "/api/playlists", { name, scope: "upNext" }, "POST", 20_000),
  });
  const autoplaySave = useMutation({
    mutationFn: async (autoplay: boolean) => {
      if (state)
        await run({
          type: "preferences",
          profileId: state.activeProfile.id,
          preferences: { autoplay },
        });
    },
  });
  const autoplay = state?.autoplay;
  const actions: MenuAction[] = [
    ...(upcoming
      ? [
          {
            label: "Save as list…",
            group: "up-next",
            run: () => {
              keep.reset();
              setName("");
              setOpen(true);
            },
          },
          {
            label: "Clear Up next",
            group: "up-next",
            run: () => {
              onClear?.();
              void run({ type: "clearUpNext" });
            },
          },
        ]
      : []),
    // Only where Autoplay has something to continue; Settings → Playback always holds it.
    ...(autoplay?.upcoming.length
      ? [
          {
            label: autoplay.enabled ? "Turn off Autoplay" : "Turn on Autoplay",
            group: "autoplay",
            disabled: autoplaySave.isPending,
            run: () => autoplaySave.mutate(!autoplay.enabled),
          },
        ]
      : []),
  ];
  const keeping = keep.isPending;
  const save = async () => {
    if (!connected || keeping || !upcoming || !name.trim()) return;
    try {
      await keep.mutateAsync(name.trim());
      setOpen(false);
    } catch {
      /* The dialog keeps the name and shows the mutation error for retry. */
    }
  };
  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          const back = options();
          if (!back) return;
          event.preventDefault();
          back.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Save as list</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="queue-list-name">List name</Label>
            <Input
              id="queue-list-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {keep.error && (
            <Alert variant="destructive">
              <AlertDescription>{keep.error.message || "Couldn't save Up next."}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!connected || keeping || !upcoming || !name.trim()}>
              {keeping ? "Saving…" : "Save list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  return { actions, dialog };
}
