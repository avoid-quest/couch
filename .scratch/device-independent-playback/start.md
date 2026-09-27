# Continuation prompt

Use the prompt below in a fresh agent attached to this worktree. The implementation
and several new files are uncommitted; a clean checkout of the branch is insufficient.

---

Coordinate and continue Couch's device-independent playback work in:
`/Users/devit/.t3/worktrees/modern-kodi/t3code-7ba35ec6`

Preserve the existing app experience: window model, navigation, player layout,
desktop/TV presentation and design system. Expand its capabilities in small,
working iterations. This is a personal project; make routine decisions and implement
them without a new approval or broad research phase.

1. Read `AGENTS.md`, `CONTEXT.md`, `docs/architecture.md`, then
   `.scratch/device-independent-playback/map.md` and `validation.md` in that folder.
   Inspect the current diff and relevant code. Preserve tracked and untracked work.
   Check current main for overlapping fixes before changing them; the desktop
   reachability fix at `3bd72c7d` is already integrated. Complete this step with a
   short status list separating implemented, verified and missing behavior.

2. Reconcile the existing `issues/` in that folder with the code. Use those issues
   as the backlog instead of creating a second plan. Start with issue 02: identify
   one useful remote source that fails in the browser, then fix that delivery path.
   Coordinate issue 05 for independent Core/native-receiver lifecycle and issue 03
   for a first real multiroom backend. Keep adaptation, multiple sessions, internet
   access and UI parity in their existing issues. State the next usable result and
   its observable completion condition before coding.

3. Use lower-thinking-effort subagents for bounded source research, bug fixes and
   independent checks. Give editing agents separate file ownership. Keep shared
   protocol/session decisions with the coordinator. Consult official docs when an
   integration requires them; load existing research only for the selected question.

4. Implement and integrate the selected result. Core remains the session authority;
   UI clients control it and playback targets render. Most sources are remote.
   Prefer direct provider-to-target playback and existing compatible renditions.
   Add relay, remuxing or transcoding only for the specific access or format gap.
   Preserve pairing, private source credentials, target ownership and idle-controller
   behavior. Snapcast/Sendspin own group timing; Couch owns queue and intent.

5. Run relevant checks and exercise the changed workflow. Include playback/control,
   handoff and recovery where affected. Keep real browser, simulated native and
   physical hardware evidence separate. Record unavailable hardware as a specific
   remaining check, then continue independent work. Follow `AGENTS.md` for packaging.

6. Update the selected issue, map and validation with the actual result and remaining
   work. Finish each iteration with what now works, what was tested and what comes
   next. Complete a usable improvement, rather than stopping at another plan.

Use `docs/architecture.md` as the design reference. The standalone-PWA research is
an unselected alternative. The existing direct-media handoff code is a starting
point; its simulated TV checks do not establish physical TV support.
