# Native local map-service delivery

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting)

![Workflow diagram for facility local delivery.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.svg)

**Quick path:** Prepare regional services separately → enable the fixed loopback route → review provider choices → test a bounded site request.

This is an opt-in loopback route for a **source checkout** using the Linux/Windows
launchers and Node.js 22. It uses the existing bounded Vite middleware.
It installs no service, downloads no map database and never enables cameras.
Prepare regional Photon and Overpass services separately from their upstream
[Photon](https://github.com/komoot/photon) and
[Overpass](https://dev.overpass-api.de/overpass-doc/en/more_info/setup.html)
instructions, including the extract's ODbL attribution and operator access policy.
No installed instance or current regional dataset was qualified here.

Before running the existing launcher, set these operator environment variables:

| Variable | Meaning |
| --- | --- |
| `DVR_GEO_LOCAL=1` | Enable local geo middleware in Vite dev/preview; disabled by default |
| `DVR_PHOTON_PORT` | Loopback Photon port, default 2322, exact upstream `/api/` |
| `DVR_OVERPASS_PORT` | Loopback Overpass port, default 12345, exact upstream `/api/interpreter` |

Linux example: `DVR_GEO_LOCAL=1 bash scripts/run-linux.sh`. PowerShell example:
`$env:DVR_GEO_LOCAL='1'`, then `./scripts/Start-IntelligentDvr.ps1`. These are explicit
operator actions; the browser never changes them. DVR_GEO_LOCAL=1 automatically
selects the source facility preview. Explicit --facility / -Facility also selects
that preview; the geo routes still require the environment opt-in. Set them in the same process
that builds/serves the app. The default browser paths are `/geo/search` and
`/geo/overpass`. A build-time custom `VITE_FACILITY_LOCAL_PREFIX` needs the matching
operator route; this native middleware currently handles `/geo` only.

The prebuilt PC camera kit does not bundle Node/Vite or these provider routes.
Its default Python service supports local cameras and recording analysis. For
local map-service delivery, install a source checkout and use the mode above.
For camera/analysis service testing, clear DVR_GEO_LOCAL; combining that flag with
camera/analysis options is rejected with an actionable message. A hosted Site also
has no access to these loopback services.

Select **Local Photon service** or **Local Overpass service** in the app and
submit a request. Native preview listens on loopback. Middleware additionally
requires a loopback Host and a matching Origin when present. It rejects cross-site
requests, unknown routes, arbitrary URLs/queries and redirects. It sends no client
cookies/authentication headers upstream. Ports must be numeric 1024–65535; upstream
hosts/paths are fixed. Search and footprint routes each allow one active request,
with 1.5/15 second spacing, size/deadline limits and no query/response disk logging.
A disabled or absent upstream returns a recoverable error, never a public fallback.

The service ports must not be exposed to untrusted clients. This route assumes
trusted local operators, not an authenticated multi-user server. Same-origin does
not certify an upstream's own egress or data acquisition. The unchanged Sites
Worker has no local service delivery. An external deployment needs separately
reviewed routing and access controls.

`node tests/facility-delivery.test.mjs` checks the middleware with bounded mock
streams. `DVR_TEST_SOCKETS=1 node tests/facility-delivery.test.mjs` additionally
starts temporary HTTP servers and exercises actual loopback transport (PowerShell:
set `$env:DVR_TEST_SOCKETS='1'` first). Linux and Windows CI run this opt-in check.
It uses synthetic provider responses, not installed Photon/Overpass or live data.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/facility-local-delivery.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
