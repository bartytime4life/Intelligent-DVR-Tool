# Recording coverage: controlled verification

Checked October 30, 2026 local time, on the coverage-fix worktree whose starting
source tree exactly matches main revision `fdd7c42d3b204448f26a1c8b13ed04c8ffe54c75`.
This checks software behavior; no physical camera was activated or installed app replaced.

- Python: 279 discovered, 273 passed, six socket tests skipped by the local
  sandbox. Nine new coverage cases include generated AVI/WebM/MP4, MPEG-4
  B-frame flushing, early decoder stop, physical byte truncation, last-frame loss,
  middle-frame corruption, absent inventory, deliberate limits and bounded work.
- Frontend: 190 discovered, 189 passed, one socket skip, using Node 22 test
  isolation disabled to expose individual results in this restricted environment.
- Four Sites adapter tests, production client/server build, local-link/media
  documentation checks and generated wiki-mirror checks passed.
- The pinned Python 3.12 readiness probe passed with PyAV 19.0.2, including its
  existing two-GiB process-memory bound and generated AVI inventory check.
- [Real pinned YOLOX-S on generated shapes](generated-model-smoke.json): healthy
  analysis completed 30 decoded frames / six paired samples with matching source
  bytes and strict-decode inventory. A controlled seven-frame OpenCV stop raised
  `MEDIA_INCOMPLETE` and wrote no result, including with sharpening enabled.

The source is generated imagery, not camera footage. Detection accuracy is
unmeasured. PyAV's additional pass and OpenCV both use FFmpeg libraries; agreement
does not prove every bit intact or all original camera footage present. Available
metadata is unsigned and can be estimated or falsified.

UI scenarios add native truncated-media failure with refused result download and
healthy retry, plus separate unverified/limit/legacy labels. Existing source
matching, recovery and installation suites remain enabled in CI. Local browser
and HTTP execution is blocked by the sandbox's loopback restriction; fresh Linux,
Windows, packaging/install and browser CI belong to the reviewed commit and must
be reported separately from these local counts.

Reproduce with `python -m unittest discover -s tests -p 'test_*.py'`, `npm test`,
`npm run build`, `npm run test:sites`, `python scripts/check-docs.py`, and
`python scripts/build-wiki.py --check`. Enable `DVR_TEST_SOCKETS=1` only on a host
allowing loopback. Physical camera acceptance, original-quality recording,
timestamp reconciliation and sustained capacity remain separate work.

[Coverage semantics, limits and references](../../recording-coverage.md).
