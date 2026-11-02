# Cumulative training verification — November 2, 2026

Implementation extends the fresh-recording training work at `4d4d155`.
[Source fingerprints](source-hashes.json) bind the implementation and focused
tests to this record. This is local software evidence, not camera accuracy or
capacity qualification.

## Checks

- Application unit tests: 322 passed, one existing skip. Includes pooling,
  compatibility across changed trained-rule hashes, per-recording regression
  guards, calibration-only fitting, distinct-source requirements, storage errors,
  the 50-session limit and actual scorecard apply gating.
- Three Chromium browser regressions passed on generated cameras and synthetic
  ONNX detectors. One records a calibration, a confirmed independent check and a
  second calibration; both sessions remain after reload, the second session
  uses the first, and existing history remains available. Another saves a checked
  improvement and verifies model/rule preselection in Recognition. The third
  checks unavailable-service recovery and mobile layout.
- Training timestamp tests: two passed. Local-service tests: 28 passed, six
  environment-dependent skips. Wiki checks: seven passed; generated companions
  match the guide sources.
- Production build and all four Sites packaging tests passed.

The browser checks use real recording/import/decode/inference contracts with
generated inputs. Their scores establish workflow behavior only. No physical
camera, owner recording, face template or private camera configuration was used.

## Product limits

Evidence belongs to this browser and exact origin. It retains up to 50 confirmed
sessions, refuses overflow and requires a matching named view, known camera key,
detector/label fingerprints, inference profile and non-threshold rule settings.
If the camera supplies no key, grouping relies on the operator's named-view
confirmation. Legacy summaries cannot be promoted into scored evidence.

Calibration sessions have equal weight; old fresh checks only guard regressions.
An apply decision requires a new confirmed fresh-check improvement and no loss
of person finds or increase in empty-room flags on any matching saved recording.
The service/model fingerprints are rechecked before saving a rule. This changes
thresholds for future recording analyses, not detector weights or old reviews.
Representative independently labeled footage is still needed to establish real
accuracy. Browser clearing, origin changes or user removal of evidence reduce
the available collection; exported count receipts cannot restore its raw scores.

The installed app's existing unsaved training result was left open during
implementation. Activating this checkout in that app requires finishing or
explicitly preserving that result before a restart/refresh.
