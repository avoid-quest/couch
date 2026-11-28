import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { forLaterQuery, removeForLater } from "@/api/for-later";
import type { MenuAction } from "@/components/RowMenu";
import { deviceName, saveLabel } from "@/copy";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { failed } from "@/toasts";
import type { ForLaterReference } from "../../../shared/for-later";
import type { HistoryItem } from "../../../shared/viewing";

// Core says why a verb failed; without its answer, Couch wasn't reached.
export function useDetailAction() {
  const name = useSessionGate().state?.installationName;
  return useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onError: (error: Error) => failed(`Couldn't reach ${deviceName(name)}.`, error),
  });
}

/** Save and Saved for an item kept in For later, matched by its page URL; without one, Save only adds it. */
export function useForLaterToggle(
  url: string | undefined,
  reference: () => ForLaterReference,
  action: ReturnType<typeof useDetailAction>,
) {
  return useForLaterSaves(action)(url, reference);
}

/** useForLaterToggle for each item of a list or shelf. */
export function useForLaterSaves(action: ReturnType<typeof useDetailAction>) {
  const shell = useShell();
  const { connected } = useSessionGate();
  const client = useQueryClient();
  const later = useQuery({ ...forLaterQuery(shell.credentials), enabled: connected });
  return (url: string | undefined, reference: () => ForLaterReference) => {
    const saved = url ? later.data?.items.find((item) => item.url === url) : undefined;
    return {
      saved: !!saved,
      disabled: !connected || !later.data || action.isPending,
      run: () =>
        action.mutate(async () => {
          await (saved
            ? removeForLater(shell.credentials, saved.id)
            : apiSend(shell.credentials, "/api/for-later", { reference: reference() }));
          await client.invalidateQueries({ queryKey: forLaterQuery(shell.credentials).queryKey });
        }),
    };
  };
}

/** A Save toggle as a menu's Keep row. */
export const saveAction = (
  save: { saved: boolean; disabled?: boolean; run: () => void },
  list?: "For later" | "Saved",
): MenuAction => ({
  label: saveLabel(save.saved, list),
  group: "keep",
  pressed: save.saved,
  disabled: save.disabled,
  run: save.run,
});

/** What For later keeps of a played item: its page, which its saved copy plays. */
export const historyReference = (item: HistoryItem): ForLaterReference => ({
  kind: "web",
  url: item.url!,
  title: item.title,
  ...(/^https?:/.test(item.thumbnail ?? "") ? { thumbnail: item.thumbnail } : {}),
  ...(item.duration != null && item.duration <= 86_400 ? { duration: item.duration } : {}),
  ...(item.collection
    ? { collection: { url: item.collection.url, index: item.collection.index } }
    : {}),
});
