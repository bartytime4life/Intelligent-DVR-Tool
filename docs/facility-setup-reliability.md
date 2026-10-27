# Dependable facility setup: implementation and qualification

Updated 2026-10-27. Follow-up to #6 and the merged #8 starter. This increment adds
address search, a direct file fallback, selectable services, explicit skip reasons,
and safe outer-only OSM relations. It does not qualify public-service availability,
mapping accuracy, interior inference or novice-user completion rates.

## Guided workflow

1. In **Locate site**, expand **Find an address or place**. Enter a place/address
   and submit **Search address**, or press Enter. There is no autocomplete request.
   Choose a suggestion, review its coordinates, then **Save site**. GPS and numeric
   entry remain available. A suggestion alone never moves or saves the plan.
2. Saving a different origin opens **Draft buildings from OpenStreetMap**. Review
   the amber numeric area (20–500 m per side); all area controls work by keyboard.
   Changing the origin geographically relocates the existing local plan, exactly
   as disclosed beside Save. No camera, room or route metadata is sent externally.
3. Choose a disclosed **Building source**, then **Load open building drafts**.
   Alternatively open an offline JSON file or paste a complete Overpass extract.
   Files are limited to 2 MB before reading; imported text is also byte checked.
4. Review measured enclosing dimensions, polygon area, source ID/edit date and
   height/floor placeholders. Uncheck unwanted shells. Complete boundary-crossing
   outlines stay whole. Skip reasons explain missing complex features.
5. **Add to existing plan** preserves cameras, rooms, labels and route. The separate
   **Replace with a clean site** choice explicitly clears them. Apply validates and
   commits once; Undo restores the preceding plan. Continue to **Buildings** to
   rename, move, resize or edit shell height/floors. Source facts remain attached.

Malformed imports clear proposed drafts, not the saved plan. Changing area, saved
plan, provider or panel state invalidates pending results. Cancel and unmount also
invalidate late responses. Offline file reads have an independent generation guard.

## Retrieval diagnosis and bounded behavior

#8 recorded public Overpass 502/timeouts; it did not prove their root cause.
This follow-up's shell could not resolve `overpass.private.coffee` or
`nominatim.openstreetmap.org` (curl error 6). A browser request to the public Photon
API was blocked by the client. Those observations establish environment access
failures, not a global provider outage or a defect in OSM data. Do not extend
timeouts indefinitely or claim successful live loading based on offline fixtures.

| Request | Bound and disclosure |
| --- | --- |
| Photon search | Explicit submit; text only, no GPS bias; 5 results requested, at most 10 accepted; 100 KB streamed response; 12 s deadline; one active request; 1.5 s spacing; 20-query session cache |
| Overpass | Explicit Load; selected bounds only; 20 s server runtime and 30 s total client deadline; 15 s UI spacing; 300 elements/2 MB response; 500 × 500 m maximum area |
| Both | Credentials omitted, no-referrer policy, redirects rejected; no automatic retries or provider failover; errors preserve saved plans |
| Session cache | Four successful footprint responses and 20 place responses; no disk persistence of query/response cache; footprint cache has a visible Clear action; tab reload discards caches |

Private.coffee and the main OSM public Overpass endpoint are user-selectable. A
provider change never sends a request by itself. A load attempt is not a successful
qualification. Public endpoints have no promised availability; use them for modest
interactive evaluation. Production and sensitive sites should use prepared local
extracts or local services. The Overpass operator specifically discourages using
public instances as the backend of a general application.

Photon's public demo permits reasonable project use but may throttle or change
without notice. Its terms are linked in the UI. Public Nominatim is deliberately
not embedded: its policy prohibits autocomplete and restricts generic generated
search services, requires application-wide throttling and an identifiable client,
and recommends switchable/cached service delivery. A Photon demo success would
not qualify Nominatim or a privately installed geocoder.

## Local and offline delivery

**Small/private site:** prepare a complete, bounded Overpass JSON extract on a
trusted machine. Keep complete ways and all relevant multipolygon parents/member
roles, including inner rings. Transfer it locally, verify its hash, save the site
coordinates, then use **Offline OSM file**. No map service is contacted. Browser
file import is cross-platform; native Windows/Linux service installation is a
separate operator task. Do not strip courtyard parents to make an outline import.

**Repeated local use:** install Photon and Overpass from their upstream releases
and prepare an appropriate regional OSM extract. Photon returns search points;
Overpass returns complete geometry. Importing a planet database is unnecessary
for this UI and is never performed by the browser. Select **Local Photon service**
or **Local Overpass service**. The operator must expose these same-origin paths:

| App path | Required upstream contract |
| --- | --- |
| `/geo/search?q=...&limit=5&lang=en` | Photon-compatible GeoJSON point FeatureCollection; preserve required OSM credit |
| `/geo/overpass` | POST form field `data` containing bounded Overpass QL; respond with complete Overpass JSON |

For example, an operator-owned reverse proxy can map `/geo/search` to the exact
loopback Photon `/api/` endpoint, and `/geo/overpass` to the exact loopback Overpass
interpreter. Use fixed upstreams, request/response limits and timeouts; do not build
an arbitrary-URL proxy. Configure authentication/network access for the deployment,
and disable address/bounds query logging where appropriate. A same-origin address
only means this app sends to that origin; the operator must verify that its proxy
and services stay local. The browser cannot certify downstream egress.

If hosting under a different prefix, `VITE_FACILITY_LOCAL_PREFIX=/private-geo`
changes both paths at build time. Only local absolute path characters are accepted;
it cannot configure a remote URL. The existing Sites worker does not implement
these services. Without operator routing the local option fails with recovery copy;
it never silently falls back to a public provider. No host service is installed or
started by this change. Regional Photon/Overpass operation is documented upstream;
native Windows, WSL and Linux deployment qualification remain separate work.

## Licensed source evaluation

| Source | Assessment and current integration |
| --- | --- |
| OSM / prepared Geofabrik regional data | ODbL; retain attribution and applicable database obligations. Implemented for complete Overpass JSON ways and supported relations. Geofabrik PBF is an operator preparation source, not a browser import format. |
| Microsoft's direct Global ML Building Footprints | Direct upstream currently states CDLA Permissive 2.0. Good candidate for bounded offline GeoJSON preparation where OSM is sparse; imagery age and ML errors require review. Not implemented in this increment. |
| Microsoft's separate U.S. Building Footprints release | ODbL in that release. Do not apply the Global ML release's license indiscriminately to other distributions. Candidate, not an active fallback. |
| Overture Buildings | Buildings theme is ODbL and has source attribution obligations. Release/source metadata and polygon holes must survive any future adapter. Not implemented. |
| Municipal/survey data supplied by an owner | Prefer a suitably licensed, recent local footprint layer when available. Verify the exact dataset's redistribution/tracing terms, CRS, units and date; an open portal is not blanket permission. No municipal dataset has been qualified here. |

No subscription, API key, imagery scraping, Google Maps extraction or paid trial
is required. Hosting, storage and data preparation still consume local resources.
The app does not accept arbitrary GeoJSON/CAD/BIM or infer building interiors.

## Geometry and evidence boundaries

The v1 renderer/coverage contract represents one simple ground-level ring per
shell. Complete multipolygon relations containing only outer ways can now stitch
segments (including reversed segments). Disjoint outers become separate editable
shells with stable component IDs and the same relation source ID. The complete
set is rejected if rings overlap or nest, connectivity is incomplete/branching,
coordinates are invalid, or the 201-vertex ring limit is exceeded. Members are
never independently imported after their parent is excluded.

Any inner/unknown member role, courtyard, building part or raised/uncertain base
remains excluded. No hole is bridged or filled, and no height/base or roof topology
is fabricated. Arbitrary complex geometry needs a holes/base-aware schema, renderer,
room containment and coverage implementation together. Present decimal precision
and computed dimensions do not establish real-world accuracy; the inherited local
projection remains an approximation. Source `retrieved` records local import time;
`updated` records the OSM edit date, not imagery or survey acquisition.

## Qualification and usability

Deterministic tests exercise complete/reversed/disjoint outers, holes, incomplete
topology, bounds, response sizes, aborts, rate limits, caching and export provenance.
Three hash-pinned historical extracts are in `tests/fixtures/facility/`, with ODbL
notice, upstream commits and explicit transformations. Two Eppan exterior shells
import; the public church courtyard is excluded; an independent recorded exterior
block yields three shells while excluding its courtyard relation. These are real
recorded OSM coordinates, not synthetic accuracy ground truth or current sites.

The browser suite in `tests/browser/facility.spec.mjs` uses those real extracts,
with mocked Photon/Overpass responses. It tests Enter submission and results focus,
location-to-area transition, selection/apply guards, additive camera preservation,
height correction, Undo, file/paste handling, malformed responses, cancellation,
boundary invalidation and a narrow viewport. It never requests real GPS or contacts
an external map provider. It records scripted draft milliseconds and one prescribed
height correction as a test attachment. These timings measure automated UI effort,
not the amount of correction needed to match a building on the ground.

The local execution sandbox denies listening sockets (EPERM), and its visible
existing preview did not serve the changed build. Local browser qualification is
therefore blocked. The dedicated GitHub Actions browser workflow runs Chromium and
uploads JSON results, failure screenshots/traces and scripted-effort attachments.
Record that workflow's exact outcome before describing these browser checks as
passed. Local production build and deterministic tests passed during implementation.

**Unverified targets:** the #6 proposal remains 80% unaided completion and median
under three minutes for a simple site, to be measured with 5–8 novice users across
address, GPS/numeric and offline routes. No participants were tested, so there is
no observed completion percentage, user median time, correction burden, camera
calibration accuracy or field error measurement. Offline/no-data cases count as
explicit outcomes, not invented completed facilities.

## Primary references (checked 2026-10-27)

- [Photon demo terms](https://photon.komoot.io/) and [self-hosting](https://github.com/komoot/photon)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Overpass shared-service guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) and [own-instance installation](https://dev.overpass-api.de/overpass-doc/en/more_info/setup.html)
- [Geofabrik extract delivery](https://download.geofabrik.de/)
- [OSM attribution and license](https://www.openstreetmap.org/copyright)
- [Microsoft Global ML release](https://github.com/microsoft/GlobalMLBuildingFootprints) and [separate U.S. release](https://github.com/microsoft/USBuildingFootprints)
- [Overture attribution and licensing](https://docs.overturemaps.org/attribution/)
- [Pinned extract manifest](../tests/fixtures/facility/manifest.json)
