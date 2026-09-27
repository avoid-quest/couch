# Continue client-first playback

Read `AGENTS.md`, `CONTEXT.md`, `docs/architecture.md`, then [map.md](map.md).
The supported workflows are implemented, including both optional Sendspin roles.
Use map.md and the latest validation receipt to select an actual remaining gap;
hardware/external-topology qualification does not imply missing application code.
The user corrected scope on 2026-09-27: clients perform media work they support;
Core coordinates authorized sessions. Jellyfin relay/adaptation work is abandoned.

1. Inspect the current worktree, stacked branches and current main. Preserve existing
   changes and recoverable archives. Done: identify the active layer and its owners.
2. Use the open issues in this folder as the backlog. Independent sessions, Sendspin,
   client audio/subtitle/live support and concurrent performance checks proceed in
   parallel where file ownership permits. Done: assign one observable result to each
   lower-effort subagent; keep protocol, architecture and integration with the coordinator.
3. Implement on the owning stack layer/worktree. Preserve Couch's window model,
   navigation, player layout and desktop/TV presentation. Prefer direct provider-to-
   client fetch and client decoding. Done: the actual workflow works and its failure
   and recovery behavior is covered.
4. Run the relevant checks from `docs/ci.md`. Use real browser/backend evidence where
   available; record hardware or external-access gaps separately. Done: tests pass,
   failures are explained, and no simulated result is described as hardware proof.
5. Commit and open/link the stacked PR, then update its issue and the short current
   map. Put detailed receipts in validation/artifacts. Continue until the remaining
   implementations are complete; an unavailable hardware check does not block others.

For previous results consult [validation.md](validation.md) only when checking a
changed behavior. Historical provider experiments are evidence, not the active plan.
