# OEM companion source verification — November 3, 2026

[Operator guide](../../oem-backup.md) · [Verification index](../README.md)

Built in an isolated checkout from upstream `4cc2c79e876756ac304068a2b4a29c0d7dee3367`.
The existing installed application, its settings/models and other unfinished
workspaces were preserved. Recordings and raw evidence stayed on the owner PC.
The source hashes in [summary.json](summary.json) bind the implementation checked
here. This is local Linux software evidence, not a merge, release or deployment
receipt. Wiki mirrors were generated locally; the native GitHub Wiki was not
published by this work.

## Checks

- Full designated Python runtime, with `DVR_TEST_SOCKETS=1`: see summary for final
  count. Includes real loopback authentication/origin tests, generated CPU
  inference, camera-independent setup and existing recorder regressions.
- Frontend: 357 discovered, 356 passed, 1 existing skip, zero failures.
- New backup UI: 12 controlled-route browser cases passed in installed Google
  Chrome, including opt-in activation, storage/error status, copy progress,
  credentials, incomplete status, fingerprint refusal and mobile layout.
- Native browser integration: 1 passed. A generated WebM goes through real local
  file copying, SQLite persistence, CPU analysis and browser review; source hash
  stays unchanged before deliberate fixture removal. The browser then opens the
  verified backup after that OEM test original has been removed. Events remain
  untouched until an explicit handoff.
- Existing controlled RTSP/recorder browser regression: 2 passed, including
  explicit record/analyze/review/stop and lost-status behavior.
- Production build and 4 Sites checks passed. Documentation link/media checks
  and 63 generated Wiki-page/navigation checks passed.
- Independent design evaluation passed at 1440, 768 and 375 px. The requested
  different-provider evaluator was unavailable; the evaluator was a separate
  agent using the available provider. No participant/novice study was performed.

The new Python cases exercise growing recordings, changed versions, duplicate
sources, low space before/during copying, source deletion/disconnection, restart,
proprietary backup-only files, analysis-size exclusion, tampered saved bytes,
source symlinks, bounded scans, single-owner locks, crash/manifest recovery,
manual-analysis contention, stop/configure serialization, private camera saves,
public/loopback endpoint refusal, no activation on save, guided stopped-recorder
setup and production entrypoint wiring.

Local logs, Playwright receipts/screenshots/traces and the isolated preview are
under ignored `qa-local/` and `test-results/`. No footage, credentials, models,
source folder paths or private SQLite files are part of this public receipt.

## Limits

Generated footage and a controlled RTSP server establish software plumbing only.
No OEM brand or physical camera was connected, and no OEM export task was
configured. Windows/Mac hardware acceptance, vendor SDK/cloud integrations,
ONVIF discovery/retrieval, codec diversity, sustained recording continuity,
power-loss durability, recognition quality and 100-camera capacity remain open.
The watched-folder quiet interval is heuristic. Production uses real seconds;
the native browser fixture accelerates only its test clock so the settling test
finishes promptly. The full-byte backup library and the sampled LAN recorder
have separate retention and fidelity semantics.
