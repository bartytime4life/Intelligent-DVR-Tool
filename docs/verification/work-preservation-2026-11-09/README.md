# Work preservation and interruptible review — November 9, 2026

[Verification index](../README.md) · [Source hashes and checks](summary.json)

This pass starts from merged main `82a316e33c7ff121951a74989ee626417a8f300f`
on `codex/dvr-work-preservation-20261109`. Source hashes bind the implementation
below. The earlier [experience record](../experience-2026-11-09/README.md) remains
unchanged. Existing checkouts, private recordings, models and installed services
were preserved; the five overload-evidence-pinned Python sources are unchanged.

## Operator changes

- Train warns before abandoning unfinished capture, consent input, checks,
  results or failed requested saves. Cancelling keeps the session; completed
  successful decisions and untouched setup can leave normally. Cleanup stops
  session-owned capture and requests analysis cancellation. A submitted face
  operation may still finish; this is not confirmed server cancellation.
- Reviews and browser rules serialize saves with shared browser locks, detect
  conflicting saves/reset, retain local edits after storage failure and offer
  both downloads plus an explicit version choice. The displaced version is
  preserved before replacement. Ten fixed copy slots never prune automatically;
  a copy can be removed only after its exact bytes were downloaded and rechecked.
  Browsers without shared locking retain edits in memory and require export.
- Result, LAN segment and backup review opening have a 120-second overall bound
  and explicit cancellation. Cancel releases controls immediately, preserves the
  current review and rejects stale completions. LAN Stop and backup Stop remain
  available during review transfers while connected. Session connection checks
  also have a deadline; old polling failures cannot overwrite a command result.
- Status announcements describe state/phase transitions. Frequently polled frame,
  byte and elapsed counters stay readable without repeated live announcements.
  Full assistive-technology acceptance remains open.

## Executed local checks

| Check | Result |
| --- | --- |
| Frontend/domain suite with loopback socket checks | 414 passed; no failures or skips |
| Production build and Sites packaging | Passed; four packaging tests passed |
| Documentation and generated Wiki consistency | Passed |
| Modified browser-spec syntax and diff whitespace | Passed |
| Independent source reviews | Training/navigation, save locking/copy removal, transfer ownership and exports reviewed; identified gaps repaired |
| Pinned overload Python sources | Byte-identical to the base revision |

No Python product source changed. Native analysis, feeds, installation and full
browser regressions are left to their existing hosted workflows; local frontend
checks do not establish those results.

## Controlled browser walkthrough

A separate loopback fixture served the built frontend and generated catalog
responses. It implements no device capture, inference, recording or copying.
An edited test-only enrollment name survived both a cancelled workspace leave
and a cancelled internal Exit. [Retained form](01-training-retained.jpg).

A later confirmation temporarily stalled the in-app browser automation. After
recovery, a failed local review save retained its confirmed decision when another
tab saved a different review. Both downloads contained their expected notes; a
failed Keep choice preserved both versions, and choosing the other version
resolved the conflict. The [archived copy](03-preserved-copy.jpg) contained the
displaced raw snapshot, with removal disabled until download initiation.
[Desktop](05-conflict-desktop.jpg) and [390px](04-conflict-mobile.jpg) checks also
confirmed no horizontal overflow at actual CSS widths of 390 and 320. Temporary
overrides and test tabs were cleared afterward. These captures bind the preceding
draft revisions in the summary; the final pass also fixes singular count wording.

The first hosted full Facility/review run at `d0e7970a` passed 101 of 103 scenarios,
including all new Train/conflict scenarios. Its two failures were test assumptions:
keyboard review read browser storage before the last shared-lock commit, and the
storage-error check expected an unchanged workspace to write on startup. The
specifications now wait for the real committed decisions and trigger a real
failed edit. Two delayed-lock unit cases prove all rapid decisions and notes are
retained. Short review/Train/conflict and mocked-transfer preflights now run before
the full browser workflow, so regressions in these paths surface earlier.

Generated specifications cover stalled result/source downloads, immediate
cancellation, late-response ownership, polling recovery and zero unintended
service writes. Full hosted-run results remain a separate revision-bound check.

No camera, microphone, location, owner footage or local models were activated.
Real-device recognition quality, continuous-recording durability, physical OEM
compatibility and sustained 100-camera capacity remain unqualified. No installed
service update, deployment or native GitHub Wiki publication was performed.
