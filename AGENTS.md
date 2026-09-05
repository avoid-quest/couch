# Repository guidance

Carry the requested work through verification. Make routine implementation choices within the agreed scope and continue independent work while waiting for missing input. Reuse authorization already given. When approval is still needed, prepare the concrete result first and explain the action that needs approval.

Follow YAGNI. Prefer readable one-line solutions where they suffice. Check current official documentation when an API or tool behavior is uncertain.

The user's current instructions take precedence over skill guidelines and older planning notes. If a skill requires pausing, link the exact SKILL.md and quote the requirement. Distinguish that requirement from your interpretation.

Before implementation or PR operations, read and apply the `gh-stack` skill. Use stacked PRs for dependent changes and separate stacks for independent work. Each PR should deliver a verifiable slice, link its GitHub issue, and begin as a draft.

Before Ubuntu installation, settings, or update work, read the [Couch appliance map](https://github.com/avoid-quest/couch/issues/1) and the relevant child issue, including comments and native blockers. Keep requirements and decisions there rather than duplicating them in this file.

When delegation is requested, give each worker a bounded assignment, its own worktree, and an explicit base revision. Run independent assignments concurrently. Assign one owner to each stack and serialize conflicting Git operations. An orchestrator delegates repository edits; implementation workers edit their assigned worktrees.

Verify the changed behavior and the task's acceptance criteria with relevant checks. Repeat or broaden checks only for new changes, failures, or unresolved concerns. Report checks that could not run and any remaining acceptance gaps.

Use plain language in updates, agent handoffs, and final reports. Lead with the result, then give the evidence and any blocker the user needs to act on.
