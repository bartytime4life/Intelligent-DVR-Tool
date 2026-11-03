# Dated training captures

The earlier [scorecard](scorecard.png) belongs to the
[fresh-recording training verification](../../verification/training-studio-2026-11-02/README.md).
Its synthetic detector responds to generated pixel brightness.

[Cumulative sessions](cumulative-sessions.png) is an actual Chromium capture
after two independently recorded, confirmed calibration sessions were saved and
the page reloaded. The first session also includes a confirmed fresh check.
The view name and every session in this capture are generated test state. A
constant-output ONNX fixture detects a person even in the empty-room prompt;
its displayed counts are not physical-camera recognition quality.

[Capture provenance](cumulative-manifest.json) identifies the source commit,
dimensions and SHA-256. The screenshot was copied without image editing from
the browser regression output. It contains no owner recording, camera address,
face template, private site or owner session history.
