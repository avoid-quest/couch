import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "@/session/gate-context";
import { ShellContext } from "./shell-context";

// Test-only: pages read connection data from the session gate, navigation
// from the shell, and server reads from Query. One test double satisfies both
// contexts; the query client lives as long as the rendered tree.
export function ShellProviders({ value, children }: { value: unknown; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}><SessionGateContext.Provider value={value as never}><ShellContext.Provider value={value as never}>{children}</ShellContext.Provider></SessionGateContext.Provider></QueryClientProvider>;
}
