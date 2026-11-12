# Contribute to Intelligent DVR

Start with [AGENTS.md](AGENTS.md), then follow the
[development and verification guide](docs/development.md) for environments,
build/test commands, browser suites and source/data-contract references.

Use an isolated branch or worktree and preserve unfinished work. Reproduce the
specific problem, make a reviewable change, and run the relevant checks. Keep
private recordings, model weights, credentials, face templates and service stores
out of Git. Respect the runtime and hosting files pinned in `AGENTS.md`.

Update canonical guides with behavior changes, regenerate their
[Wiki companions](docs/wiki/README.md), and preserve historical receipts. Include
the tested revision, actual pass/skip counts and remaining limits in the review.
Public source, a passing test and an installed deployment are separate states.

Report security issues through [SECURITY.md](SECURITY.md). The repository has no
assigned software license; see [project terms](README.md#checks-and-project-terms)
and [third-party notices](docs/third-party-notices.md) before reuse.
