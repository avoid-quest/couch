import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { NativeModeGate } from "@/sections/shell/PlaybackDevice";
import { SessionGate, useSessionGate } from "./session/session-context";
import { registerAppShellWorker } from "./register-sw";
import { router } from "./router";
import "./index.css";

document.documentElement.classList.add("dark");
registerAppShellWorker();

function SessionRouter() {
  const { queryClient, identity, localHost, connected } = useSessionGate();
  // beforeLoad and the rendered shell share the live identity. Re-evaluate
  // existing matches after role/revocation/reconnect transitions as well.
  useLayoutEffect(() => { void router.invalidate(); }, [queryClient, identity?.authority, identity?.device?.id, identity?.claimAvailable, connected]);
  return <RouterProvider router={router} context={{ queryClient, identity, localHost, connected }} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NativeModeGate>
      <SessionGate upNext={targetDeviceId => void router.navigate({ to: "/now", search: { queue: true, targetDeviceId } })}><SessionRouter /></SessionGate>
    </NativeModeGate>
  </StrictMode>,
);
