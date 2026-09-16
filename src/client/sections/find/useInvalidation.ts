import { useContext, useEffect, useState } from "react";
import { QueryClientContext, useQuery } from "@tanstack/react-query";

/**
 * Bridges socket Query invalidations to a section-owned read. Cleanup migrates
 * these reads through api/ queryOptions and deletes this bridge.
 */
export function useInvalidation(rootKey: string) {
  const queryClient = useContext(QueryClientContext);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!queryClient) return;
    return queryClient.getQueryCache().subscribe(event => {
      if (event.type === "updated" && event.action?.type === "invalidate" && event.query.queryKey[0] === rootKey) setAttempt(value => value + 1);
    });
  }, [queryClient, rootKey]);
  if (!queryClient) return attempt;
  useQuery({ queryKey: [rootKey], queryFn: async () => 0, staleTime: Infinity }, queryClient);
  return attempt;
}
