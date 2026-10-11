import { redirect } from "@tanstack/react-router";
import type { DeviceIdentity } from "../../../shared/devices";

// Bootstrap/pairing may render the shell while authority is unknown; reads and
// controls remain disconnected. Once synchronized, native and browser routes
// use the very same identity rendered by SessionGate. The server still enforces
// every request independently.
export async function requireAdministrator({ context }: { context: { identity: DeviceIdentity | null; connected: boolean } }) {
  if (!context.connected || !context.identity) return;
  if (context.identity.authority !== "administrator" && context.identity.authority !== "host") throw redirect({ href: "/settings", replace: true });
}
