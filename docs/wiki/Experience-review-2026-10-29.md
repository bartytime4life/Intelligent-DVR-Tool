# Experience and functionality review — October 29, 2026

> **Dated record.** Findings and evidence below retain their stated revision and date. Use the [visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook), [current capability register](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) and [guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) for today’s operator path.

Source baseline: merged main `fc25843f1a6abfe2a23a31998beea6211c52f1a6`
(PR #24). The 276 tracked files were reconstructed and matched against their Git
blob hashes before editing. Earlier local workspaces and recordings were preserved.

This is a source/behavior review with automated regression coverage. It is **not**
a completed visual or novice-user audit. Starting a local preview failed with
`listen EPERM`; Chrome also rejected the static file URL. Neither restriction was
changed. Hosted Chromium results must be reported separately from local checks.

## Repaired gaps

| Finding | Prior effect | Change |
| --- | --- | --- |
| Full-run handoff blocked | Two starter samples prevented 999/1,000-event runs from entering Events; reset added the samples back | Export, explicit clear to an empty queue, Undo, and validated review-export restoration |
| Receipt reimport overwrote reviews | Previously confirmed/dismissed observations became pending and lost notes | All import paths use the same merge and retain existing decisions |
| Silent queue truncation | Receipt imports and simulated events could discard older records above 1,000 | Every insertion refuses overflow atomically |
| Sample reset deleted real history | Reset removed imported observations and reviewed samples | Preserve imported records, reviewed samples and their notes |
| Recognition session lost on navigation | Visiting Events unmounted the recording, parsed results, position and filter | Retain that workspace in memory; pause footage when hidden; release on page close/reload |
| Hidden browser-storage failures | Save exceptions were swallowed while toasts claimed success | Persistent warning/export controls; no false save-success message; invalid initial entries are not automatically replaced |
| Navigation did not match the URL | Refresh and Back/Forward could return the wrong workspace | All seven workspaces have synchronized hash routes |
| Ambiguous evidence and queue state | Matched footage still showed an unmatched-state message; samples and model results were hard to separate | Correct fingerprint state, compact progress/counts, source filtering and actionable empty states |
| Same ID could attach an old decision to new evidence | An unsigned repeated ID was treated as sufficient identity | Reject conflicting source/model/camera/time/label/score/rule fields |

The full-run finding was also reported in the
[PR #24 review](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/24#discussion_r4409089269).
These fixes preserve the existing dark monitoring wall and teal/amber controls.
Clear is explicit and offers export; Undo is session-local. A second clear replaces
the earlier undo copy only through the dialog, which offers that copy's export.
Restoration preserves newer current decisions and refuses conflicts/overflow.

## Highest-value remaining work

| Priority | Gap and consequence | Concrete next deliverable and acceptance |
| --- | --- | --- |
| 1 | Analysis still requires an external command and result-file handoff | A bounded local job service with file/model/rule selection, progress, cancellation and automatic result opening. Require local-only binding, explicit start, path restrictions, byte/time/job limits, safe errors and existing receipt validation; no automatic monitoring |
| 2 | Events cannot yet reopen a specific source frame in the retained Recognition session | Link events using their exact source/model fingerprint and observation identity; wrong-source events must never open another recording's boxes |
| 3 | Browser history is not a durable review database | Transactional local review storage, verified backup/restore and restart recovery. Demonstrate quota/disk-full behavior without a false success claim |
| 4 | Recognition quality remains unqualified | Representative labeled clips separated by camera/session, fixed thresholds, per-condition recall/precision, missed-event and false-review burden; retain a held-out evaluation set |
| 5 | Live ingest, recording and tracking are separate missing workloads | One-source recorder with restart/reconnect, retained footage integrity and disk-full recovery before staged 1/5/25/50/100-source acceptance. Tracking needs independent ID-switch and occlusion tests |
| 6 | Facility editor remains a large download and lacks field/novice acceptance | Measure cold start and interaction responsiveness on real target devices, split heavy rendering modules when measurements justify it, then run the existing novice-study kit. Current build still reports a roughly 1.81 MB minified facility chunk |
| 7 | Source matching reads up to 512 MiB into memory | Cancellable incremental hashing in a worker with a measured memory ceiling. Preserve exact file correspondence and zero footage upload |

No model, detector threshold, camera connection, recording, driver or host setting
was changed. This pass does not establish actual tracking, recognition accuracy,
live monitoring, installed-service readiness or sustained 100-camera capacity.

## Research relevance

SciSpace discovery identified cross-camera admission/scheduling, threshold
calibration and human-review candidates. Only the primary source independently
opened in this pass is used for a research conclusion:
[ReXCam, arXiv:1811.01268v4](https://arxiv.org/abs/1811.01268v4) uses learned
spatiotemporal correlations and recovery searches to reduce cross-camera work.
The useful inference for this project is to investigate calibrated, recoverable
scheduling **after** basic quality and workload accounting are qualified. Its
reported results are not evidence for this project's hardware or camera capacity.
No research prototype was installed. A scoped Drive search returned no matching
project documents, so current repository source controlled this review.

## Verification

- Production build and four Sites packaging checks pass locally; existing large
  facility chunk warning remains.
- Full local Node suite: **84 pass, one skip, zero failures** (81 frontend cases
  plus four packaging cases in total). The skipped case requires a loopback
  listener. Tests ran with Node's documented in-process test isolation option
  because the sandbox's child runner did not expose per-case results reliably.
- Ten added domain tests cover decision preservation, 1,000-event capacity,
  non-destructive overflow/reset, backup restoration, conflicting IDs, malformed
  backups, storage errors, empty queues and workspace routes.
- Five added browser scenarios cover full-run recovery/export/Undo, receipt and
  backup restoration, session/navigation continuity, quota failure and 390 px
  queue controls. The existing generated-video test now checks source retention,
  paused hidden playback and corrected match status.
- Browser scenarios use synthetic fixtures only. No user recording is transmitted.
- Hosted CI results are linked in the pull request when available. Browser test
  passes do not substitute for a screenshot review or actual novice acceptance.

See [recording recognition](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details) for the updated user flow.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/experience-review-2026-10-29.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
