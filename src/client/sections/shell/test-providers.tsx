import { useState, type ReactNode } from "react";
import { createTestQueryClient } from "@/testing/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "@/session/gate-context";
import { PlaybackClockContext, emptyPlaybackClock, type PlaybackClock } from "@/session/playback-clock";
import { ShellContext } from "./shell-context";

// Test-only: pages read connection data from the session gate, navigation
// from the shell, and server reads from Query. One test double satisfies both
// contexts; the query client lives as long as the rendered tree.
export function ShellProviders({ value, children }: { value: unknown; children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  const clock = (value as { state?: { player: PlaybackClock } }).state?.player ?? emptyPlaybackClock;
  return <PlaybackClockContext.Provider value={clock}><QueryClientProvider client={client}><SessionGateContext.Provider value={value as never}><ShellContext.Provider value={value as never}>{children}</ShellContext.Provider></SessionGateContext.Provider></QueryClientProvider></PlaybackClockContext.Provider>;
}
