import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { hiddenItemKey, matchesHidden, type HiddenCandidate, type HiddenRule } from "../../shared/hidden";
import { failed, undoable } from "@/toasts";
import { apiJson, apiSend, type ApiCredentials } from "./client";

// The session invalidates ["hidden"] whenever any device changes it.
export const hiddenQuery = (credentials: ApiCredentials) => queryOptions({
  queryKey: ["hidden"],
  staleTime: 60_000,
  queryFn: ({ signal }) => apiJson<{ rules: HiddenRule[] }>(credentials, "/api/hidden", { signal }),
});

export const addHidden = (credentials: ApiCredentials, rule: Pick<HiddenRule, "kind" | "value" | "label">) =>
  apiSend<{ rule: HiddenRule }>(credentials, "/api/hidden", { rule });
export const removeHidden = (credentials: ApiCredentials, id: string) =>
  apiSend(credentials, `/api/hidden/${encodeURIComponent(id)}`, undefined, "DELETE");

const none: HiddenRule[] = [];

/**
 * What the Couch hides: `isHidden` drops an item from a browse page, and `hide` hides one at once (the rule shows
 * before Core confirms it) with an Undo that removes it again.
 */
export function useHidden(credentials: ApiCredentials, connected: boolean) {
  const client = useQueryClient();
  const query = hiddenQuery(credentials);
  const rules = useQuery({ ...query, enabled: connected, retry: false }).data?.rules ?? none;
  const isHidden = useCallback((item: HiddenCandidate) => matchesHidden(rules, item), [rules]);
  const hide = useCallback(async (item: HiddenCandidate) => {
    const pending: HiddenRule = { id: `pending-${crypto.randomUUID()}`, kind: "item", value: hiddenItemKey(item), label: item.title, createdAt: Date.now() };
    client.setQueryData(query.queryKey, current => ({ rules: [pending, ...current?.rules ?? []] }));
    try {
      const { rule } = await addHidden(credentials, { kind: pending.kind, value: pending.value, label: pending.label });
      undoable(`Hid ${item.title}.`, () => {
        client.setQueryData(query.queryKey, current => current && { rules: current.rules.filter(other => other.id !== rule.id) });
        void removeHidden(credentials, rule.id).catch(reason => failed(`Couldn't show ${item.title} again.`, reason))
          .finally(() => client.invalidateQueries({ queryKey: query.queryKey }));
      });
    } catch (reason) {
      // Offline the refetch below can't replace the guess, so it goes here.
      client.setQueryData(query.queryKey, current => current && { rules: current.rules.filter(rule => rule.id !== pending.id) });
      failed(`Couldn't hide ${item.title}.`, reason);
    } finally {
      await client.invalidateQueries({ queryKey: query.queryKey });
    }
  }, [client, credentials.origin, credentials.token]);
  return { rules, isHidden, hide };
}
