export type JackTopology = { connections: string; properties: string; types: string };
function entries(text: string) {
  const ports = new Map<string, string[]>();
  let values: string[] | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (/^\s/.test(line)) values?.push(line.trim());
    else { values = []; ports.set(line, values); }
  }
  return ports;
}

/** Exact input bindings, direction and format; event counters detect transient changes. */
export function verifyJackBindings(topology: JackTopology, bindings: { input: string; output: string }[]) {
  const connections = entries(topology.connections), properties = entries(topology.properties), types = entries(topology.types);
  const reasons: string[] = [];
  for (const { input, output } of bindings) {
    const upstream = connections.get(input);
    if (upstream?.length !== 1 || upstream[0] !== output) reasons.push(`${input}: expected exactly ${output}`);
    for (const [port, direction] of [[input, "input"], [output, "output"]]) {
      if (!properties.get(port!)?.some(value => new RegExp(`\\b${direction}\\b`).test(value))) reasons.push(`${port}: wrong or unknown direction`);
      if (!types.get(port!)?.includes("32 bit float mono audio")) reasons.push(`${port}: wrong or unknown sample format`);
    }
  }
  return { verified: reasons.length === 0, reasons, bindings };
}
