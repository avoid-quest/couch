import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { identityQuery } from "@/api/controllers";
import { isNativeHost } from "@/session/native-context";

// beforeLoad gate for the pages the settings registry marks administrator-only.
// The TV itself manages everything; remotes prove authority against
// /api/controllers/me through the shared Query cache.
export async function requireAdministrator({ context }: { context: { queryClient: QueryClient } }) {
  if (isNativeHost()) return;
  const identity = await context.queryClient.ensureQueryData(identityQuery()).catch(() => null);
  if (identity?.authority !== "administrator") throw redirect({ href: "/settings", replace: true });
}
