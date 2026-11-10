# Merged software baseline — November 9, 2026

[Verification index](../README.md) · [Machine-readable results](summary.json) · [Timestamped CI excerpts](ci-excerpts.log)

[PR #93](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/93) merged as
`9ae03ce597f2688d8c4f5a2fce0d13954617e0f4`. Its tested head
`fd7b60023df894d69f397635ae117cb1901c3730` has the identical Git source tree.
All four PR workflows completed successfully. This record refreshes the current
software baseline while preserving earlier local and historical receipts.

## Platform results

Counts below are separate jobs, not combined platform totals.

| Platform | Frontend | Sites packaging | Python discovered / passed / skipped / failed |
| --- | --- | --- | --- |
| [Linux](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/42729059073/job/129542105639) | 451 passed | 4 passed | 510 / 510 / 0 / 0 |
| [Windows](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/42729059073/job/129542106053) | 451 passed | 4 passed | 510 / 424 / 86 / 0 |
| [macOS Apple silicon](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/42729058775/job/129542101129) | 451 passed | 4 passed | 510 / 395 / 115 / 0 |

The [PC kit workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/42729058818)
packaged and smoke-tested clean extracted installs on Linux and Windows. The Mac
workflow also checked fresh source paths, repeat installation, generated local
analysis, duplicate starts and restart. These ran on CI machines.

## Browser and generated runtime results

The [browser workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/42729059154)
completed each suite below without retries. Preflight cases overlap later suites;
the numbers are deliberately not added into a single distinct-test total.

| Suite | Passed |
| --- | --- |
| Review/unfinished-training preflight | 13 |
| Interrupted review/status preflight | 10 |
| Full general/Facility browser suite | 151 |
| Generated CPU analysis and training | 19 |
| Generated webcam and RTSP feeds | 13 |
| Controlled LAN recording | 2 |
| OEM backup setup/status/error browser checks | 23 |
| Copied generated recording through native local analysis | 1 |

The 151-case run finished in one CI invocation. The earlier
[local workspace verification](../workspace-experience-2026-11-09/README.md)
retains its interrupted run, corrected assertion and repeated-case history. This
new CI result does not rewrite those observations or establish the original
intermittent map-abort failure's cause.

## Acceptance boundaries

These results establish source, installer and generated-input contracts on the
recorded CI runners. They do not establish owner-PC installation, physical-camera
or OEM compatibility, representative detection/tracking quality, sustained
endurance, or 100-camera throughput. No owner device or private footage was used
for this documentation refresh. Repository Wiki mirrors remain separate from
native Wiki publication and deployment.
