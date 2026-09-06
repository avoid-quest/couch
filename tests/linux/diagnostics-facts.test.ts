import { expect, test } from "bun:test";
import { assertPlaybackDiagnosticFacts } from "./diagnostics-facts";

const facts = ["mpv version", "Video output", "Audio output", "Hardware decoder"].map(name => ({ name, value: "observed", source: "mpv" }));

test("native qualification rejects an omitted fact as well as an explicit unknown", () => {
  expect(() => assertPlaybackDiagnosticFacts(facts)).toThrow("Audio device selection");
  expect(() => assertPlaybackDiagnosticFacts([...facts, { name: "Audio device selection", value: null, source: "mpv" }])).toThrow("Audio device selection");
  expect(() => assertPlaybackDiagnosticFacts([...facts, { name: "Audio device selection", value: "auto", source: "mpv" }])).not.toThrow();
});
