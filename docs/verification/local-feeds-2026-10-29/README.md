# Local feed integration — October 29, 2026

Qualified application revision:
[`14f5eb381f15c6aa6034c466056b7e4390c12e07`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/14f5eb381f15c6aa6034c466056b7e4390c12e07).
Built from merged PR #27 (`97fa9fccf9ad027152fd3c9ab7623665ae8bf108`).
PR #28 was merged during qualification; the follow-up branch repairs its browser
and review findings while retaining the analysis/review contracts.

Scope: no generated camera imagery or new default sample events; explicit browser
webcam and bounded owner-configured LAN RTSP previews. [Usage and limits](../../local-camera-feeds.md).

## Verified checks

| Check | Result | Evidence |
| --- | --- | --- |
| Linux | Build, 97 frontend + 4 packaging passes; 171 Python passes, no skips | [Run 40908666650](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40908666650), job 123570313775 |
| Windows | Build, 97 frontend + 4 packaging passes; 126 Python passes, 45 platform-specific skips | Same run, job 123570313954 |
| Browser | 19 existing workspace/facility/recognition scenarios + 5 local analysis scenarios + 7 feed scenarios; all 31 pass | [Run 40908666828](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40908666828), job 123570315489 |
| Native RTSP | Authenticated TCP stream → pinned relay → actual OpenCV decoder → JPEG → guarded loopback HTTP; sustained beyond former 8-second disconnect | Python native integration case on Linux and Windows |
| Review preservation | Recording analysis, source mismatch, failure/cancel/recovery, export/Undo and legacy decisions retain their regressions | Existing Python/Node/browser suites |
| Local executor | Build; 100 Node passes/one socket skip; 169 Python passes/two socket skips; docs/wiki checks | Socket creation rejected with EPERM in this selected session; no local server claimed |

[Machine-readable counts](summary.json) · [CI excerpts](ci-excerpts.log).
Browser artifact `12912263720` contains empty desktop/mobile setup, synthetic
webcam and synthetic RTSP screenshots plus result JSON. Archive SHA-256:
`daf234af41fcf2d432d62891e0b525ef578424befc0c7cf8fa2a999cae836b21`.

The seven feed scenarios cover empty startup/no stock image fetches, explicit
webcam frames and disconnect/navigation/reconnect, permission denial/recovery,
actual RTSP browser delivery, invalid channel/cancel/recovery, mobile overflow,
and hidden-page webcam cleanup. Webcam capture uses full Chromium with a generated
test device. The lightweight headless shell returned `NotSupportedError`; that
failed run was not counted as capture validation. The app now explains this error.

## Defects corrected during qualification

- Added explicit accessible labels so source selection is unambiguous.
- New explicit connections replace terminal preview entries without retaining an
  unbounded failure history or hiding the next active source.
- A quiet decoder-to-DVR request direction no longer terminates a healthy media
  stream. The regression retains an actual stream for more than eight seconds.
- One/two/four visible-tile limits include the selected source and bound mounted
  previews, using the existing resource-selection contract.
- Full Chromium, rather than its capture-unsupported headless shell, validates
  webcam permission and actual frames. Production code does not fake a webcam.

## Limits and delivery

No physical DVR or webcam was available to this execution session. The RTSP test
carries generated JPEG pixels with an auth challenge; Chromium's test camera
produces generated frames. These results establish transport, lifecycle and UI
integration only. They do not establish H.264/H.265 firmware compatibility,
sustained latency, live recording/inference, tracking, recognition quality or
100-camera capacity. No private footage or credentials were uploaded.

The existing owner-private hosted Site was not changed: its supported source
workflow failed to resolve `git.chatgpt-team.site`. The local repository/GitHub
implementation and tests are delivered separately; no successful Site deployment
or persistent local server is claimed. Hosted DVR access would still require the
same-computer local bridge.
