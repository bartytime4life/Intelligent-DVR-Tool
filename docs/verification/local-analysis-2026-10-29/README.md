# Local analysis service qualification — October 29, 2026

Baseline: main `9294482ed38e025e413c3d735408b585b8ea7572`, including merged
PR #25. All 280 tracked files matched their Git blob hashes in a new working
snapshot. Previous workspaces and recordings were preserved.

The implementation adds one bounded loopback CPU job service and browser controls.
It reuses the existing analyzer, rule engine, review JSON parser and source matcher.
It does not establish live deployment, tracking, independent accuracy or camera
capacity. See [service behavior and limits](../../local-analysis-service.md).

Local focused tests initially passed 13 Python cases with one HTTP case skipped,
and seven new JavaScript contract cases. The native synthetic test ran the real
CPU worker and analyzer, producing six sampled frames and one rule observation.
The fixture is a constant ONNX output on generated pixels, not recognition quality.

An explicit local HTTP test failed at socket creation with `PermissionError:
Operation not permitted`. The environment forbids IPv4 loopback listeners. This
restriction was not changed or bypassed. HTTP and browser acceptance therefore
runs in GitHub CI and is reported separately in the pull request. No private
footage is sent there.

Final full-suite results and source revision are recorded in the pull request.
