/** How a receiver's direct connection runs: straight across the network, or through the TURN relay. */
export type LiveRoute = "direct" | "relay";

// The pair the publisher's connection selected (the transport's, else the nominated one): relayed when either end's
// candidate is the TURN relay's.
export function routeOf(stats: RTCStatsReport): LiveRoute | undefined {
  let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
  stats.forEach(entry => { if (entry.type === "transport" && entry.selectedCandidatePairId) pair ??= stats.get(entry.selectedCandidatePairId); });
  stats.forEach(entry => { if (entry.type === "candidate-pair" && entry.nominated && entry.state === "succeeded") pair ??= entry; });
  if (!pair) return undefined;
  return [pair.localCandidateId, pair.remoteCandidateId].some(id => id && stats.get(id)?.candidateType === "relay") ? "relay" : "direct";
}
