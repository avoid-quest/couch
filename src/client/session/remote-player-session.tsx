import type { PropsWithChildren } from "react";
import { useLocation, useSearch } from "@tanstack/react-router";
import { SessionGateContext } from "./gate-context";
import { useSessionGate } from "./session-context";
import { remotePlayerSession } from "./player-control";

export function RemotePlayerSession({ children }: PropsWithChildren) {
  const session = useSessionGate();
  const { pathname } = useLocation();
  const { targetDeviceId } = useSearch({ strict: false });
  return <SessionGateContext.Provider value={pathname === "/now" && targetDeviceId ? remotePlayerSession(session, targetDeviceId) : session}>{children}</SessionGateContext.Provider>;
}
