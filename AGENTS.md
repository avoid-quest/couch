# Couch

A media player everyone shares. Use the terms in [GLOSSARY.md](GLOSSARY.md).

- **Smallest change** that does what was asked. Add tests, docs, settings or limits only when the request needs them. A number the owner gives is a target to aim for, not a gate.
- **Ask** when the request is unclear or the work grows past it. Show options before building anything new or visual.
- **Upstream first**: read the existing Couch code and the library's docs before writing your own. For the desktop shell, releases and repo setup, read how [t3code](https://github.com/pingdotgg/t3code) does it.
- **Real app, real content**: check behavior by running `bun run app` with its own `COUCH_DATA_DIR` and `COUCH_PORT` and playing real media, plus a phone-sized browser for phone layouts. Stop only the processes you started; leave the installed Couch (port 4100, `quest.avoid.couch` data) alone.
- **Owner only**: running workflows, tags, version bumps, publishing, deploying and merging. Do each only when the owner asks for it.
- Notes, research, handoffs and measurements go in `.scratch/` (gitignored) or the PR body.
- Before handing back, run `bun run typecheck` and `bun run test`.
- PR titles are plain sentences: they become the release notes.

## Where to look

- [docs/architecture.md](docs/architecture.md): how Core, the client and the app fit together.
- [docs/usage.md](docs/usage.md): running from source, data directories, the installed app's logs.
- [docs/ci.md](docs/ci.md): integration tests, workflows, packaging and releases.
- [docs/design.md](docs/design.md): UI principles and building blocks.

## Review guidelines

Review against [CODING_STANDARDS.md](CODING_STANDARDS.md). Report bugs, security issues and violations of that file. Leave out requests for more tests, docs or comments unless a standard asks for them.
