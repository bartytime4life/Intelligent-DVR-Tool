# Recording analysis restart recovery — October 29, 2026

Scope: opt-in Linux storage for the last recording-analysis job, based on main
`d3afc389ffc1e175858a32232cadd37bdc8a3120` (merged PR #35). The pull request
records its exact implementation head and hosted checks. This record describes
local working-tree verification; it does not certify later revisions.

The implementation stays within `edge/` for the service/store, `src/` for existing
Recognition controls and `tests/` for regressions. This record uses the existing
`docs/verification/` responsibility root. Its small private state envelope is job
metadata, not a replacement inference receipt. See the
[behavior, bounds and rollback](../../local-analysis-service.md#optional-linux-restart-recovery).

## Local results

The full Python suite passed **219 tests without skips**, including **21 Linux
recovery cases**. Tests exercise corrupt/missing metadata, substituted sources,
changed and oversized files, unsafe paths/links, competing process owners,
cancelled/interrupted jobs, replacement, failed admission, cleanup, rename and
final-sync uncertainty. The cleanup test first reproduced a stuck-running job;
cleanup failures now produce a terminal failure and block new persistent dispatch.

A native test kills an actual analysis service after its child reaches processing.
The Linux parent-death mechanism kills the native child; the test reaps it and
reopens the store as SERVICE_INTERRUPTED without dispatch. Another test runs a
real generated-video/constant-model job, closes the service and reopens the same
completed bundle. Synthetic output tests integration, not recognition quality.

All **six local browser analysis scenarios** passed with installed headless
Chrome. The new scenario completes native synthetic inference through HTTP,
stops and restarts the service, reconnects and opens the same job and review hash.
It asserts exactly one start request across both service lifetimes. Hosted
Chromium and Windows checks are separate evidence in the PR.

The owner-PC manual browser check used an existing approved public-reference
excerpt with pinned YOLOX-S on CPU: **300 decoded / 60 analyzed frames**. After a
real service restart, the same completed job, source hash, review hash and
unchanged committed metadata reopened. The source matched and browser video
decoded at 1920 × 1072. No human observations were confirmed or sent to Events.
Media, weights, detailed results and local screenshots stay on the PC.

The existing frontend suite passed **172 tests without skips**. Production build,
four Sites packaging checks, local documentation links and wiki projection passed.
Final source-bound PC-kit installation and hosted checks are recorded in the PR.

## Limits

Recovery requires an explicit Linux `--state-dir`; launchers do not currently
forward that option. Default temporary operation remains available on both
platforms; Windows rejects the persistent option. Only the last job is retained,
and a new explicit job replaces it. No startup replay, resumable inference,
continuous recording, durable human decisions, power-cut durability, adversarial
owner-file authentication, representative accuracy or 100-camera qualification
is established. The original installed service was not upgraded by these tests.
