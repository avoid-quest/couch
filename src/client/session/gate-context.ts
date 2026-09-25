import { createContext } from "react";
import type { SessionGateValue } from "./session-context";

// Kept apart from SessionGate so tests can provide it without loading the gate.
export const SessionGateContext = createContext<SessionGateValue | null>(null);
