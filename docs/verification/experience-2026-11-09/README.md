# Recognition usability and backup recovery — November 9, 2026

[Verification index](../README.md) · [Source hashes and check summary](summary.json)

Local changes start from merged main
`4c2e59d4e0900b8ce6bc7ea81b1ea33121f98e56` on
`codex/dvr-improvements-20261109`. The summary binds the changed product sources.
Existing checkouts, installed services, recordings, models and configuration were
preserved. This is a source and controlled-browser verification record, not an
installation, publication or field qualification.

## Changes

- Recognition offers four explicit tasks with saved-recording analysis selected
  initially. Controllers stay mounted so task changes keep pending folder edits,
  retained jobs and the current review. Backup running/attention notices remain
  on its task button. Configuring the LAN source opens its task and moves focus.
- Backup and LAN recorder details become explicitly last-known after contact is
  lost. Stale copy progress has no advancing progress bar. Recorder uncertainty
  remains visible in other workspaces until a successful status refresh.
- Malformed recovery receipts and UUID-named files/links cannot block healthy
  copies from recovering. All indexed receipt fields are validated; skipped
  entries remain untouched and the recovery warning survives normal operations.
- Bulk Undo uses persisted decision revisions plus evidence/decision checks.
  Unchanged browser-storage round trips remain undoable; later actions, even with
  identical timestamps and notes, remain intact. Old saved reviews still load.
- CSV retains analysis state, live session and capture time. Bounded result reads
  cancel oversized/aborted downloads, preserve original errors and release reader
  locks. Recording/backup/segment hashing receives cancellation.
- Legacy backup completion strings leave recording coverage explicitly
  unverified. Operator guides and generated Wiki source mirrors were updated.

## Executed checks

| Check | Result and scope |
| --- | --- |
| Frontend/domain suite with loopback socket checks enabled | 375 passed, no skips |
| Full Python suite in an existing Python 3.12 native environment | 510 discovered; 498 passed, 12 skipped |
| New recovery regressions against original source | All five fail before the repair and pass after it |
| Production build and Sites packaging tests | Build passed; four packaging tests passed |
| Documentation and generated Wiki checks | Passed; current media and historical receipts retained |
| Independent source review | Reviewed recovery, adapters, Undo, task continuity and lost-status behavior; repaired the cross-tab Undo finding |

## Current browser walkthrough

The in-app browser used the changed frontend and a separate loopback fixture
serving generated status only. The fixture has no device, inference, recording
or file-copy implementation. Browser checks did not connect to an installed DVR
service. Updated automated browser specifications are retained for subsequent
CI; the full browser suite was not run in this pass.

1. **Recording task entry — healthy.** The selected path and its first connection
   action are visible without passing through two unrelated setup forms.
   [Before](01-recognition-before.jpg) and [after](02-recognition-after.jpg).
2. **Backup task switching — healthy.** An unsaved generated source path remains
   after opening saved results and returning. Background copy activity remains
   on its task button while another task is open. A generated status failure
   changes that notice to unknown and labels the previous progress as last-known.
3. **Recorder interruption — healthy.** Generated active status followed by an
   unavailable endpoint leaves an unknown-state warning in
   [Events](03-recorder-unknown.jpg). Explicit refresh to stopped status clears
   it. A failed first connection creates no recording-activity footer.
4. **Responsive recording task — healthy within checked widths.** Actual CSS
   viewport checks at 390px and 320px show no horizontal overflow.
   [390px capture](04-recognition-mobile.jpg). Temporary viewport overrides were
   cleared afterward. Full accessibility/assistive-technology acceptance was not
   performed.

The development preview emitted one temporary React dependency-array warning
while code was hot-reloaded during editing. A full page reload used the final
hook definitions; no additional application errors appeared in that fresh load.
The build retains its existing large Facility bundle warning.

## Remaining acceptance and prioritized work

- Physical OEM/codec compatibility, real-camera recognition quality, uninterrupted
  recording, drive/power-loss durability and sustained 100-camera capacity remain
  unqualified. No owner footage, camera, microphone, location or models were used.
- Guard leaving an unfinished guided Train session before it unmounts; verify
  cancellation and deliberate abandonment with generated recordings.
- Preserve a queue with unsaved local storage errors when another browser tab
  saves, rather than adopting the other snapshot without a conflict choice.
- Validate assistive-technology announcements for rapidly polled telemetry and
  complete the updated automated browser suites on supported CI platforms.

No deployment, installed-service replacement or native GitHub Wiki publication
was performed.
