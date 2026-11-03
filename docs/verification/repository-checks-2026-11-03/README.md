# Repository checks and repairs — November 3, 2026

[Verification index](../README.md) · [Summary and source hashes](summary.json)

This follow-up starts from merged main `78c1723`. The two earlier feature PRs
were already merged before the checks began. Fixes were developed in isolated
worktrees; the installed app, private recordings, models and other local work
were preserved. The source commit and per-file hashes in the summary bind the
checked implementation. This record is software evidence, not a deployment or
physical-device qualification.

## Repairs

- Keep the application and setup available when a saved backup disk is offline
  or settings are invalid. Preserve the saved configuration and recover on an
  explicit reconnect/start without recreating missing backup storage. Reopen stale
  handles after a same-path drive reconnect and keep setup available on index I/O errors.
- Report incomplete recursive scans, use full Windows file identities before
  copying, independently check Windows descriptor/path timestamps, and resolve
  macOS temporary-path aliases in the fault fixtures. The Mac preservation smoke
  includes the expected empty backup lease in its full-file snapshot.
- Keep a healthy shared GPU available after invalid media; preserve genuine
  accelerator failure handling and Linux-only result-persistence boundaries.
- Limit development HTTP delivery to frontend files/dependencies, default both
  listeners to loopback, and require a loopback TCP peer for local geo forwarding.
- Validate queue admission before thumbnail writes and bind image writes/reads/
  pruning to source/model/session and observation fields. Rejected imports cannot
  replace another reviewed observation's image. Older ID-only images are kept
  but are not displayed as source-verified; resending verified original evidence
  refreshes them without changing decisions or notes.
- Reject malformed tracking summaries and invalid optional sample metadata.
  Preserve originating live sessions, mark sent/dismissed items by stable ID,
  and age overlays from capture time instead of response time.
- Preserve pending System drafts across another tab's save, pause every local
  file player on hidden pages, and replace stale CPU-only/live-off UI claims.
- Keep saved facility drafts in their canonical form so unit entry does not
  leave a false unsaved state. Submit completed mobile map-button taps without
  depending on a compatibility click after dragging.
- Allow an explicit installed-browser override in browser test configurations;
  isolate the Vite serving regression's dependency cache from active previews.

## Validation

The summary records final counts. On the owner Linux runtime, all **496 Python**
tests and **365 frontend** tests passed with loopback checks enabled and no skips.
The production build, four Sites checks, source-launcher smoke, PowerShell/shell
syntax and a fresh PC-kit extraction/hash check passed. Python, JS/MJS and shell
source files were syntax checked; JSX is checked by the production build.

All **146 browser checks** passed: 99 workspace/facility checks, 19 native analysis/training
checks, 13 camera-feed checks, two native LAN-recorder checks, 12 backup UI
checks and a real CUDA backup-copy → analysis → source-matched review. The CUDA
case uses generated footage and the existing pinned owner model; its receipt
must report CUDA startup node execution. A second real-worker check first rejects a generated invalid recording with VIDEO_OPEN_FAILED, keeps the shared GPU healthy, then completes the next generated recording on CUDA with 203 startup nodes. No physical camera or private recording
was activated. The image-conflict and two-tab draft regressions use actual
IndexedDB and browser storage.

Dependency compatibility passed. npm audit found no known advisories, and an
[OSV batch lookup](https://google.github.io/osv.dev/api/) found no matches for the
18 exact Python package/version pairs declared in the requirements files.
These checks do not establish that all dependencies are vulnerability-free.

The Windows timestamp repair follows the [CPython path API](https://github.com/python/cpython/blob/3.12/Modules/posixmodule.c) and [descriptor API](https://github.com/python/cpython/blob/3.12/Python/fileutils.c): they report different meanings for ctime. Identity, size and modification time still match across APIs; each API retains its full independent before/after check.

The Codex Security Standard scan completed against the unchanged pre-fix source,
with one medium and one low finding. Both are repaired and regression-checked in
this follow-up. Its canonical report remains local and revision-bound; it does
not certify the new revision or mark a separate cloud finding closed. Independent
review covered every edge Python module and non-vendored product JS/JSX; remaining
auxiliary/vendor/test source coverage is explicitly partial. The pinned inference,
journal, supervision, scheduler and profiling sources remain byte-identical.

A current in-app-browser design audit captured (1) Recognition entry, (2) local
connection and (3) empty-folder validation. All three steps behaved correctly;
no novice study or full assistive-technology certification is claimed. Screenshots,
raw logs, generated videos and test traces stay in ignored local evidence folders.

Documentation and 63 generated Wiki/navigation files were checked. The native
GitHub Wiki was not published. Physical OEM compatibility, codec diversity,
recording endurance, power-loss durability, accuracy and 100-camera capacity
remain separate qualification work.
