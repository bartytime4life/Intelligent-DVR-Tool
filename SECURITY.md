# Security boundaries

This prototype is for human-reviewed observations. It does not control cameras,
locks, accounts or enforcement. There is no face identification, access decision,
network scanning, automatic containment, background capture or cloud inference.

Do not commit private recordings, receipts, model weights, API keys or camera
credentials. Local input files and models should be trusted and processed in a
resource-limited environment; native media/model decoders are an attack surface.
The direct CLI adapter is bounded by frame/event/image counts, not a hard
inference deadline or sandbox. The optional local job service adds worker memory
and wall-time bounds as described below. Never expose it as an unauthenticated upload service.

The browser imports bounded JSON metadata (1 MB, 1,000 events) and renders it as
React text. There is no HTML injection or URL-based media fetch from a receipt.
Receipt-only imports do not borrow sample imagery. Recognition can attach the
exact recording after a source-hash match. Imports remain unsigned records;
file correspondence does not authenticate detections or measure their accuracy.

Browser-saved review decisions are editable, not an authoritative audit trail.
Future operational use requires authentication, authorization, encrypted
transport, durable review/audit records, retention and credential handling.

The initial code received focused local validation, not a Codex Security Cloud
scan or a certification. Report suspected issues privately to the repository owner.


The facility editor imports at most 2 MB of validated geometry/label JSON and
copies declared fields only. Imported URLs are never fetched and labels render
as text. Plan data stays in browser localStorage and explicit exports. The
optional online street-map toggle sends the visible viewport to OpenStreetMap;
it is off by default and not persisted. Review sensitive site coordinates before
enabling any external basemap. No camera connection, capture, inference or person
identity association is started by the planner. Rehearsal links are simulated,
unverified, session-only decisions. Model/image imports and arbitrary remote map
URLs are intentionally not accepted by this implementation.

Submitted address/place search sends only the submitted text to the selected
Photon public demo or configured same-origin local search. Typing, opening a
panel or changing provider sends no request. No GPS bias, camera plan or recordings
are sent by search. Search responses have a 100 KB streamed cap and 12-second
deadline; queries/results have a bounded session-memory cache, not a disk cache.
Avoid private addresses on public services.

The open-map starter sends selected geographic bounds to the chosen fixed
Private.coffee/OSM public Overpass endpoint or configured same-origin local service
only after an explicit Load action and disclosure. Cameras, rooms, routes and
recordings are not sent by the adapter. Responses have a 2 MB streamed cap and
timeouts. Supported simple ways and complete outer-only relations, plus bounded
source records, are validated before a reviewed transaction. Unsupported
courtyards/parts and invalid geometry are excluded; provider HTML/media URLs are
not executed. Public map data is not authenticated survey evidence.

Both request paths omit credentials and referrers, reject redirects, and have no
automatic retries or provider failover. Default local paths are `/geo/search` and
`/geo/overpass`; an operator must configure fixed upstreams and appropriate access
and logging controls. The Sites Worker does not supply these services. Same-origin
requests do not certify the operator's downstream routing or egress. Offline JSON
file/paste review avoids search/footprint-provider requests when coordinates are
entered manually; online tiles and optional fonts remain separate external paths.
Use prepared local extracts/services when site addresses or bounds must stay local.

System imports setup/host JSON up to 64 KiB and validates numeric bounds before
using declared fields. Snapshot labels render as text; imported commands or URLs
are never executed. Snapshots and plans stay local to this browser until an
explicit export. The optional `edge.host` probe reports only CPU/RAM totals,
capacity at selected paths and an opt-in fixed read-only NVIDIA inventory. It
omits host/user names, paths, serials and network addresses and refuses overwrite.
Exported analyzer policies have strict fields, bounded values and exact-file
hashes. They limit OpenCV threads/frames and the scheduler's retained sample
bytes/slots/dispatch age. They are not OS quotas, a native-code sandbox, a GPU
backend or a hard wall-clock deadline. No storage provisioning or host tuning
is performed by System or the supplied launchers.

## Local recording job service

The optional `edge.local_service` binds only to `127.0.0.1`, checks exact Host and browser origin, and requires a per-service token for jobs and artifacts. Loopback is reachable by every account on the computer. On Linux, every API request, including the token-issuing session endpoints, must come from a TCP socket owned by the service's own OS account (looked up in `/proc/net/tcp` and `tcp6`, IPv4-mapped clients included); if those tables are unavailable, as on WSL1, API requests are refused. Windows has no such check: any local account can open the session endpoints and obtain the token, so run the service only on a computer whose other accounts you trust. It accepts opaque catalog selections, never client paths/commands. An explicit `--allow-recording-import` switch enables same-computer file copies with a 64 MiB per-file cap, 20-file/512 MiB inbox limits, 64 MiB free-space reserve, container-header and SHA-256 verification, exclusive publication, and idempotent content-derived names. Imports do not start inference. An OS-released folder lock serializes imports across services; after a crash, the next import reclaims the left-over partial file. No remote upload endpoint or cloud inference is added. One isolated CPU worker invokes the existing analyzer with bounded local snapshots, time, memory, threads and frame/output limits. It is single-user software for owner-approved recordings and hash-pinned models, not a hostile-model sandbox. See [the full boundary and shutdown/recovery behavior](docs/local-analysis-service.md).

### Worker failure codes and the diagnostic log

Analysis, segment and preview workers report a failure only as `failure.json`
containing exactly `{"code": ...}` from a fixed allowlist (see `edge/failures.py`).
Parents accept at most 1 KiB, exactly that key and a listed code; anything else is
ignored. Signal and Windows NTSTATUS exits are classified (`CPU_LIMIT`,
`FILE_SIZE_LIMIT`, `WORKER_KILLED`, `WORKER_CRASHED`, `MEMORY_LIMIT`). Codes never
contain native messages, paths, URLs, addresses or credentials.

With `--state-dir` (Linux), the service also keeps a local diagnostic log in
`<state-dir>/diagnostics/service.log`, rotated at 1 MiB across three owner-only
(0600) files in a 0700 folder. Each line is a time, a fixed event code and values
that are only fixed codes, opaque hex job/segment/session IDs or numbers. Any other
value is written as `REDACTED`, so paths, recording/model/source names, URLs, IP
addresses, credentials and host or user names cannot be logged. Without a state
directory the log is off. The log is unsigned and editable by the same account,
so it is not an audit trail. It is never uploaded. Review it before you share it.

The service and Check warn when `local-feeds.json` is readable by group or other
accounts on POSIX. The warning does not change file permissions.

Webcam clip capture uses only the connected video track. It requests a stop at
60 seconds and discards clips exceeding 64 MiB; browser scheduling/encoder
allocations are not hard real-time or OS-memory guarantees. No microphone is
requested. Printable reports escape all source/label/rule/note strings, use a
no-network content security policy, and contain no scripts. CSV cells neutralize
formula-leading text. Reports may contain private notes; exports are explicit.

## Local camera preview boundary

The optional RTSP bridge uses owner-configured private IPv4 sources, a pinned TCP
relay that rejects redirects, same-origin/Host/token checks, bounded subprocesses
and expiring preview leases. Credentials travel only through worker stdin; camera
frames remain local. Webcam permission is requested only on explicit connection,
and tracks stop on disconnect/hidden page/navigation. See
[the complete connection and trust limits](docs/local-camera-feeds.md).
Native decoder code is not a complete malicious-device sandbox. No cloud relay,
automatic network scan, ONVIF discovery, live inference or recording is enabled.

## Public webcam previews

The explicit public-webcam adapter accepts only owner-configured HTTPS JPEG/MJPEG
sources selected by opaque ID. All DNS answers must be public; the connection
pins one validated IPv4 while retaining TLS hostname verification. No redirects,
credentials, cookies, environment HTTP proxies, HTML players or dynamic browser
URLs are accepted. Public previews share bounded workers and leases. Image byte,
pixel and native decoder limits apply before frames are exposed. See
[public source permission, external disclosure and exact limits](docs/public-webcams.md).
Provider capture time, freshness and media safety are not authenticated. The
owner must approve provider terms; an open endpoint alone grants no reuse rights.

## Optional LAN recording

The [one-camera recorder](docs/lan-recording.md) uses the existing private-IPv4
RTSP allowlist and redirect-refusing relay. Only explicit Start activates capture
and segment analysis. No internet/public source is eligible. Credentials stay in
the local source configuration and private child pipe; management stays loopback
with Host/origin/token checks. Recording recovery never starts capture. Retention
can delete queued/completed evidence; export what must remain. Use account-private
storage (0700 on Linux; restricted inherited ACLs on Windows). This is not an
encrypted vault, forensic audit log, gapless DVR or power-loss durability claim.
During an explicit recording session, segment jobs reuse one model copy in the
recorder's private `work/` folder. That copy is SHA-256 verified once per Start
and then reused only while its file signature is unchanged. Each receipt still
binds the hash of the model bytes the analyzer parsed, and the service checks that
hash against the pinned catalog value.
