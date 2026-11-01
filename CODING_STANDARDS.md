# Coding standards

Reviewers apply these to every PR. A finding names the rule it breaks.

## Scope

- The diff does what the PR says and nothing more: no unrequested features, settings, refactors or clean-ups on the side.
- Every constant, limit, cap, timeout or threshold has a reason given in the code or the PR. Prefer the library's default.
- No speculative generality: an option, hook, parameter or abstraction needs a second real caller.
- Reuse what exists (Couch's helpers, the library's API, shadcn components) before adding a new one.

## Code

- A reader follows it at a glance: one statement per line, short functions with honest names, early returns over nested conditions.
- A file has one responsibility. Split a file when it grows past about 500 lines or does several unrelated things.
- Comments say why in one or two lines. They don't narrate history ("now", "previously", "after #123") or restate the code.
- Delete dead code; don't comment it out or keep it behind a flag.

## Tests

- A test locks behavior that could break silently and that a person or Core depends on: parsers of outside data, security boundaries, Core's state rules, or a bug that actually happened.
- These don't earn a test: that something was removed or isn't shown, markup, labels, CSS classes, exact copy, call order, internal constants, or the text of source and docs files.
- Extend an existing test file before adding a new one. Unit tests are `tests/*.test.ts(x)`; Core integrations are `tests/*.integration.ts`.
- Tests write only to temporary directories.

## Docs

- Docs describe how Couch works now, for the next reader. Changelogs, dates, measurements, audit logs and "now does X" belong in the PR body.
- Change a doc only when the behavior it describes changes. An ordinary UI change doesn't need a doc change.
- Research notes, handoffs and plans go in `.scratch/`, not `docs/`.
