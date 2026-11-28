import { createContext, useContext, type CSSProperties } from "react";
import type { ShellValue } from "./AppShell";

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside the app shell.");
  return value;
}

/** The room's light (RoomLight.tsx), for what opens over the page outside the shell, such as the Mixer. */
export const RoomStyle = createContext<CSSProperties | undefined>(undefined);
