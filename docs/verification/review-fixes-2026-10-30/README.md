# Review fixes — October 30, 2026

Source: PR #45, merged as [`cd33e38`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/cd33e380a5bef22f688224109ef8e887005d9cfe).
The local runs below used the pre-merge head `b4679ee`, whose tree is identical to
`cd33e38`. PR #46 ([`11f358c`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/11f358c6d94eea4f6fb2dc728a2ef8b428caa106))
only changes how three Windows launchers store line endings; checkouts produce
the same bytes. See the [review record](../../review-2026-10-30.md) for what changed.

## Local checks

| Check | Result |
| --- | --- |
| `npm test` | 207 passed, 1 loopback test skipped |
| `npm run test:sites` | 4 passed |
| `npm run build` | Passed; the existing large lazy-loaded facility chunk warning remains |
| Python 3.12 `unittest` | 307 passed, 8 socket tests skipped; with `DVR_TEST_SOCKETS=1`, 307 passed |
| `scripts/check-docs.py`, `scripts/build-wiki.py --check` | Passed |
| Playwright 1.56.1, local Google Chrome | Facility 41/41, analysis 12/12, feeds 10/10, recorder 2/2 |

The Python runs used a CPython 3.12 virtual environment built from
`edge/requirements-test.txt`. The analysis, feeds and recorder browser suites
served a fresh production build through the local service. Browser checks also
covered dialog backdrop and focus behavior, unreadable-storage backup and
download, cross-tab adoption, the facility leave prompt and the absence of
external font requests.

## CI on `main`

| Commit | Cross-platform checks | PC install kit | Facility browser regression |
| --- | --- | --- | --- |
| `cd33e38` | [success](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41171492298) | [success](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41171492193) | [success](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41171492231) |
| `11f358c` | [success](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41172572192) | [success](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41172572136) | [success](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41172572139) |

The cross-platform workflow runs the Python suite on Linux and Windows, which is
the first execution of the Windows-specific fixes (sharing-violation retries,
fixed content types, 8.3 short-path comparison and buffer model loading) on
Windows. These are CI checks on hosted runners, not physical-PC acceptance.

## Boundaries

- No DAST scan ran: no StackHawk API key was configured.
- Synthetic fixtures only; no physical camera, DVR or recording left the test host.
- These checks establish fixed behavior, not recognition quality, tracking or
  100-camera capacity.
