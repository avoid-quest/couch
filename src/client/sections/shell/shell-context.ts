import { createContext, useContext } from "react";
import type { ShellValue } from "./AppShell";

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside the app shell.");
  return value;
}

// Leaf components that only adjust presentation (never data) may degrade
// gracefully outside the shell, e.g. in isolated component tests.
export function useOptionalShell(): ShellValue | null {
  return useContext(ShellContext);
}
