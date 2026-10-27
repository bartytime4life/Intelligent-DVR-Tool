# Security boundaries

This prototype is for human-reviewed observations. It does not control cameras,
locks, accounts or enforcement. There is no face identification, access decision,
network scanning, automatic containment, background capture or cloud inference.

Do not commit private recordings, receipts, model weights, API keys or camera
credentials. Local input files and models should be trusted and processed in a
resource-limited environment; native media/model decoders are an attack surface.
The first adapter is bounded by frame/event/image counts, not a hard inference
deadline or sandbox. Never expose it as an unauthenticated upload service.

The browser imports bounded JSON metadata (1 MB, 1,000 events) and renders it as
React text. There is no HTML injection or URL-based media fetch from a receipt.
Source imagery for imported observations is intentionally unavailable. Imports
are unverified, unsigned records and require original-footage/hash checks.

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
