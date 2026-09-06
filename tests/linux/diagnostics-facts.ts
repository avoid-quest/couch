import { strict as assert } from "node:assert";
import type { DiagnosticFact } from "../../src/shared/diagnostics";

export function assertPlaybackDiagnosticFacts(facts: DiagnosticFact[]) {
  for (const name of ["mpv version", "Video output", "Audio output", "Audio device selection", "Hardware decoder"]) assert.notEqual(facts.find(fact => fact.name === name)?.value ?? null, null, `${name} is observed during playback`);
}
