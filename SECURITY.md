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

The optional `edge.local_service` binds only to `127.0.0.1`, checks exact Host and browser origin, and requires a per-service token for jobs and artifacts. It accepts opaque catalog selections, never uploaded footage or client paths/commands. One isolated CPU worker invokes the existing analyzer with bounded local snapshots, time, memory, threads and frame/output limits. It is single-user software for owner-approved recordings and hash-pinned models, not a hostile-model sandbox. See [the full boundary and shutdown/recovery behavior](docs/local-analysis-service.md).
