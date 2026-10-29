# Native local map-service delivery

This is an opt-in loopback route for the existing Linux/Windows Vite launchers.
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
operator actions; the browser never changes them. Set them in the same process
that builds/serves the app. The default browser paths are `/geo/search` and
`/geo/overpass`. A build-time custom `VITE_FACILITY_LOCAL_PREFIX` needs the matching
operator route; this native middleware currently handles `/geo` only.

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
