# Browser-local byte receipt review — November 9, 2026

Base: `72d66cdbe362a69574b36c3ab9e949b480e3a7e8`.

Recognition's existing backup task now includes Check backup receipts. It reads
at most 1 MiB per explicitly selected JSON file, validates the byte-check schema,
computes its SHA-256 in the browser and compares source bytes, scope, revision,
verifier, time order and optional earlier-record links. No video, API request,
model, storage write or device activation is part of this component. Failed
imports preserve the previous record, and Clear invalidates pending reads.

Reported CPU/CUDA, coverage, review matching and field compatibility are separate
rows. Generated input stays labeled. Unsigned metadata never establishes actual
GPU execution, recognition quality, physical recovery or capacity.

Local validation: 13 receipt/task unit tests passed. The first production build
caught an unsupported icon name; it was replaced with an existing library icon.
Production build and all four Sites compatibility tests passed after that repair.
The complete Node suite passed 504 tests with two environment-specific skips;
documentation checks passed 1,300 links and the generated Wiki was refreshed. Added
three generated browser regressions for CI: local-only interpretation, preserving
a valid record after a bad import, and partial/CUDA metadata separation. Local
browser capture was unavailable because the connected browser-control API failed
while binding/creating tabs; no visual audit or local browser pass is claimed.
No dependencies, model weights, real footage or cameras were installed/accessed.
