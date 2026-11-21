import { useEffect, type PropsWithChildren } from "react";
import { useLocation } from "@tanstack/react-router";
import { SessionGateContext } from "./gate-context";
import { useSessionGate } from "./session-context";
import { readPlayerSearch, remotePlayerSession } from "./player-control";

export function RemotePlayerSession({ children }: PropsWithChildren) {
  const session = useSessionGate();
  const { pathname, search } = useLocation();
  const { targetDeviceId } = readPlayerSearch(search);
  const remote = pathname === "/remote" || (pathname === "/now" && !!targetDeviceId);
  const { command, connected } = session;
  useEffect(() => {
    // Remote's Up next keeps the same TV until the window leaves both routes.
    if (remote) return () => void command({ type: "control", deviceId: null }).catch(() => {});
  }, [remote, command]);
  // Core lets a window's Remote go when it disconnects; an open Up next takes its TV back, as Remote does.
  useEffect(() => {
    if (pathname === "/now" && targetDeviceId && connected)
      void command({ type: "control", deviceId: targetDeviceId }).catch(() => {});
  }, [pathname, targetDeviceId, connected, command]);
  return (
    <SessionGateContext.Provider
      value={
        pathname === "/now" && targetDeviceId
          ? remotePlayerSession(session, targetDeviceId)
          : session
      }
    >
      {children}
    </SessionGateContext.Provider>
  );
}
