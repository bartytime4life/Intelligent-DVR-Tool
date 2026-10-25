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
