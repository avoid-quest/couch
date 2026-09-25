import type { NativeDiagnostics } from "../shared/diagnostics";
import { diagnosticBuild } from "./diagnostics-system";
import { redactDiagnosticText } from "./diagnostics-redaction";

export function createNativeDiagnostics(send?: (requestId: string) => void) {
  let pending: { id: string; resolve: (value: NativeDiagnostics) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  return {
    collect(): Promise<NativeDiagnostics | null> {
      if (!send) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        if (pending) { reject(new Error("Diagnostics are already loading.")); return; }
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { pending = null; reject(new Error("The app didn't respond.")); }, 2_000);
        pending = { id, resolve, reject, timer };
        try { send(id); } catch { clearTimeout(timer); pending = null; reject(new Error("Couldn't reach the app.")); }
      });
    },
    receive(requestId: string, report: unknown) {
      if (!pending || pending.id !== requestId) return;
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      if (!report || typeof report !== "object" || !("facts" in report) || !Array.isArray(report.facts)) { current.reject(new Error("The app sent an invalid report.")); return; }
      current.resolve({ build: diagnosticBuild("build" in report ? report.build : null), facts: report.facts.slice(0, 40).map(fact => ({
        name: redactDiagnosticText(fact?.name, [], 80), source: redactDiagnosticText(fact?.source),
        value: typeof fact?.value === "number" ? Number.isFinite(fact.value) ? fact.value : null : fact?.value == null ? null : redactDiagnosticText(fact.value),
      })) });
    },
    close() {
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error("The Couch app disconnected.")); pending = null; }
    },
  };
}
