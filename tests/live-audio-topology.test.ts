import { expect, test } from "bun:test";
import { verifyJackBindings } from "./audio-lab/topology";

const topology = { connections: "sink:out\n  record:in\nrecord:in\n  sink:out\n",
  properties: "sink:out\n  properties: output,\nrecord:in\n  properties: input,\n",
  types: "sink:out\n  32 bit float mono audio\nrecord:in\n  32 bit float mono audio\n" };
const bindings = [{ input: "record:in", output: "sink:out" }];
test("presentation requires the exact single upstream audio output", () => {
  expect(verifyJackBindings(topology, bindings).verified).toBe(true);
  expect(verifyJackBindings({ ...topology, connections: topology.connections + "  other:out\n" }, bindings).verified).toBe(false);
  expect(verifyJackBindings(topology, [{ input: "record:in", output: "other:out" }]).verified).toBe(false);
  expect(verifyJackBindings({ ...topology, properties: topology.properties.replace("output", "input") }, bindings).verified).toBe(false);
  expect(verifyJackBindings({ ...topology, types: topology.types.replaceAll("32 bit float mono audio", "8 bit raw midi") }, bindings).verified).toBe(false);
});
