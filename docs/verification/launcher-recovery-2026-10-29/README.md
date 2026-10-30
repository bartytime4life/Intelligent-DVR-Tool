# Linux launcher analysis recovery — October 29, 2026

Base: `e1a252ee7708b89ad3b7c6228c132b2519db86c1` (merged PR #36).
This change connects the existing ResultStore to the ordinary PC launcher;
it does not add another store, journal, schema or automatic job workflow.

## Contracts

- Linux Start/Check accept `--state-dir` or `DVR_STATE_DIR`; an explicit path wins.
  `--temporary` overrides the environment setting and leaves saved files intact.
- Check uses the store's existing validation and recovery logic in an inspection
  mode: no store creation, pruning or state rewrite. It checks private ownership,
  permissions, symlink components, known contents, exclusive ownership and
  completed artifact hashes/source binding. Free bytes are reported, not reserved.
- Start revalidates, then uses the same service `--state-dir` option as PR #36.
  Completed results reopen; interrupted work becomes SERVICE_INTERRUPTED.
  Check alone never marks a job interrupted. No model is run on startup/recovery.
- Install ignores an inherited DVR_STATE_DIR. Explicit --install --state-dir is
  refused. No saved state is migrated, permission-repaired or deleted by setup.
- Windows retains temporary analysis and existing installers/port behavior.

## Verification

The local implementation run passed 226 Linux Python tests with no skips,
172 frontend tests with the socket check enabled, four Sites checks and the
production build. The first frontend run omitted the optional socket flag and
reported 171 passes / one skip; the socket-enabled run passed all 172.
Six analysis browser scenarios also passed with installed Chrome, including
real native CPU processing and the existing service-restart/source-match case.
The pinned Playwright browser could not install on this host's Ubuntu version;
the local temporary config selected system Chrome. Hosted browser CI uses the
supported Ubuntu 24.04 image and pinned Chromium independently.

`scripts/smoke-pc-install.py` installs and reinstalls an extracted kit, exercises
the actual launcher/HTTP server, and runs the new Linux recovery harness.
`scripts/smoke-pc-recovery.py` uses generated video and a constant-output ONNX
model; these fixtures do not measure recognition quality. The local extracted-kit
run established:

| Scenario | Result |
| --- | --- |
| Fresh Start with persistence | Private owner-owned 0700 store; no automatic job |
| Completed job, service restart | Same job ID, review and frozen recording; fresh API token |
| Check and reinstall over completed state | Same retained file hashes and permissions |
| Kill service after real native progress | Restart reports SERVICE_INTERRUPTED; no automatic retry |
| Check over interrupted state | Retained bytes/permissions unchanged until Start |
| Invalid file/shared directory/symlink/missing parent/foreign contents/corrupt state | Both Check and Start refuse; existing bytes preserved |
| Competing service | Refused even on another port |
| Disable persistence through --temporary | Separate temporary result disappears after restart; saved state unchanged |

Unit checks also exercise mismatched ownership, missing owner write/search
permissions, Linux-only selection and forwarding, disabled-store bypass, and
path-free readiness output. Existing recovery fault tests continue to cover
atomic commit failures, source substitutions and parent-death worker termination.

The PC install workflow runs the extracted-kit smoke on Linux and Windows;
the recovery extension runs only on Linux. Exact revision, install receipts and
recovery receipts are retained in each workflow's artifacts. Use the successful
head run linked by the pull request; preliminary local kit runs label a working
tree based on the base revision and do not qualify the final commit by themselves.

## Reproduce

With the pinned environment installed and the interface built:

~~~bash
DVR_TEST_SOCKETS=1 .venv/bin/python -m unittest discover -s tests -p 'test_*.py'
DVR_TEST_SOCKETS=1 npm test
npm run test:sites
python3.12 scripts/build-pc-kit.py --output kit/Intelligent-DVR-PC.zip --revision "$(git rev-parse HEAD)"
python3.12 scripts/smoke-pc-install.py --archive kit/Intelligent-DVR-PC.zip --evidence evidence
~~~

Choose a new archive/report path on rerun; the builder refuses overwrites.
The install smoke uses disposable extracted folders, never the owner's installed
app or real camera credentials. It explicitly starts three synthetic analysis
jobs for acceptance and opens no physical camera.

This establishes repository and installation behavior. It does not upgrade or
accept the owner's currently installed application, qualify Windows persistence,
power-cut durability, continuous recording, live AI, representative model quality
or sustained 100-camera operation. Browser review decisions remain separate.
