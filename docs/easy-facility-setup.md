# Next: easy facility setup from a map

Status: researched and queued after the guided editor. This document is a proposed
implementation and usability study, not a claim of a working automatic importer.
Requested by the owner on 2026-10-27. Sources checked on that date.

Increment delivered: the Locate site form now has an optional one-shot browser
location suggestion, accuracy text, cancellation and manual fallbacks. The initial
OSM simple-way draft importer, numeric search area and common shapes are now
implemented; see [map-measurements-and-shapes.md](map-measurements-and-shapes.md).
Address search, holes/parts and assisted imagery remain queued.

## Recommended experience

Keep MapLibre, Three.js and the existing editor. Add a **Create from location**
entry point to Locate site. Give the user four clear choices: search an address,
use my location, enter coordinates, or import a site file. Location is a shortcut;
it must not be the only path or imply that the device is at the facility.

1. **Find the site.** Search only after submitting the address. The location button
   requests one position after a click, shows its accuracy, then lets the user move
   the pin. Handle denied, unavailable and timed-out location without trapping the
   user. Do not start continuous location watching.
2. **Select the facility area.** Draw a rectangle or polygon, or adjust its numeric
   bounds. Show the area and included buildings. Start with a proposed 1 km² limit
   and the editor's 100-building limit; calibrate those limits during testing.
3. **Draft buildings.** Find licensed open footprints within that area. Show a
   staged preview: outlines first, then simple 3D shells. Do not commit automatically.
   Choose buildings intersecting the area, flag boundary crossings, and let the
   user include the complete building or exclude it. Do not cut a building in half
   silently. Avoid duplicate features from overlapping providers.
4. **Review the draft.** Offer Keep, Remove, Add missing building, Split/Merge and
   Adjust outline. Display source, dataset release, available acquisition date and
   height status. A dataset release date is not an imagery capture date. Use
   “Height estimated” when height is absent or inferred; never manufacture confidence
   scores. Label unknown floors as unknown rather than as detected floors.
5. **Confirm and continue.** Commit the reviewed shells as one undoable transaction,
   then continue to floors, rooms, labels and cameras. Preserve the previous plan
   until confirmation. Exterior imagery cannot establish interior rooms, entrances,
   camera positions or real coverage.

The recommended first experiment uses an open footprint source. It removes more
manual work than tracing imagery and avoids a mandatory inference installation.
Its appeal to users is a hypothesis that needs the study below.

## Practical approaches considered

| Approach | Benefit | Limits and decision |
| --- | --- | --- |
| Microsoft Global ML Building Footprints, direct release | Existing worldwide polygons; height estimates for some locations; current project states CDLA Permissive 2.0 | Preferred initial global candidate for a private planning database. Validate coverage, geometry and the exact downloaded release's license; dates and quality vary. These are derived outlines, not surveys. |
| Licensed municipal/county footprints and building heights | May be more current or locally authoritative | Prefer when the source actually permits the required derivative use. Availability, fields and licenses vary by jurisdiction; no universal connector. |
| Overture Buildings | Unified building and building-part data; supports height/levels and extrusion | Strong second adapter. The Buildings theme is ODbL: assess attribution and derivative-database/share-alike obligations before mixing with private exports. Do not treat all Overture themes as identically licensed. |
| OpenStreetMap footprints | Editable community source with occasional levels/height | Useful where mapping is good. ODbL applies; incomplete mapping and public endpoint limits need handling. Do not use public Overpass as an unlimited production backend. |
| Google Open Buildings | Separate downloadable open dataset, distinct from Google Maps imagery | Candidate in supported regions. The v3 coverage excludes the mainland U.S.; it is not a default fallback for a mainland U.S. facility. Retain the applicable dataset license and attribution. |
| Licensed overhead imagery plus local segmentation | Can suggest outlines for new or unmapped buildings | Second phase: NAIP in the contiguous U.S., suitable local open orthophotos, or user-owned drone imagery. Confirm each asset's rights and metadata. Trees, shadows, roof overhangs and connected roofs require corrections. |
| SAMGeo / SAM-family image assistance | Point or box prompts can help a user isolate a roof | Optional local worker, not required browser inference. SAMGeo is MIT; model weights and dependencies require their own license review. Measure hardware needs and usefulness before choosing a model. No quality or runtime claim yet. |
| LiDAR / photogrammetry | Better path to measured elevations and richer exterior shape | Advanced optional import. 3DEP is public-domain U.S. elevation data; availability and acquisition dates vary. Ground DEM alone is not building height; use classified points or surface-minus-ground with matching vertical references. Drone capture has acquisition effort. |
| User GeoJSON / CAD / IFC / BIM / survey | Can use an existing accurate model | Best private/offline route when available. GeoJSON first; CAD/BIM need separate units, georeferencing, floor and coordinate-system adapters. Current facility JSON is not a generic GIS/BIM importer. |
| Manual map tracing / QGIS preparation | Works when automatic data is poor | Retain as a fallback, using imagery licensed for tracing. QGIS can georeference supplied imagery; it adds specialist work so it should not be the novice default. |
| Google Maps / Earth / My Maps | Familiar navigation and map annotation | Google My Maps supports shapes and KML/KMZ export, but that does not grant rights to extract the basemap's buildings. User-owned KML geometry could be an advanced adapter after provenance validation. It is not automatic facility extraction. |
| Google Photorealistic 3D Tiles / Cesium renderer | Attractive existing exterior visualization | A display option under its own API terms, attribution, billing and cache requirements; it is not permission to extract reusable editable buildings. Changing the renderer does not change data rights. Defer. |

“Subscription-free” means no mandatory paid mapping or inference subscription.
Self-hosted data, storage, bandwidth and optional local processing still consume
resources. Public services and trial allowances are not a permanent free SLA.

## What Google can and cannot contribute

Maps URLs can launch a Google Maps view without an API key. This may be useful as
an explicitly opened external reference, subject to the applicable terms. It does
not license imagery extraction, turn a share link into a building dataset, or
automatically permit connecting Google content to MapLibre. Keep any such link
integration out of the first importer until the terms for its exact use are settled.

The Maps JavaScript API requires an API key and billing. Google's current general
terms restrict scraping, derivative content from map imagery, and combining Core
Services with non-Google maps. The stated examples include digitizing building
outlines from the Satellite basemap. Therefore do not implement a Google screenshot
or tile-to-building pipeline under the ordinary terms. A different negotiated
license would have to authorize the intended workflow before reconsideration.

Solar API is not a shortcut for this security planning use: its service-specific
terms limit use to energy-system feasibility, design/install and specified energy
transactions. Browser geolocation is a separate web standard and does not require
the Google Maps API; it requires a secure context and the user's location permission.

These are engineering decisions based on published terms, not a determination of
every possible negotiated or regional license. Recheck the terms before integration.

## Implementation sequence

1. Add the location/address/manual-pin entry point and area selector. Use a
   replaceable geocoder interface. If public Nominatim is used in a small pilot,
   obey its app-wide rate limit, attribution, caching and no-client-autocomplete
   requirements. Prefer a self-hosted or separately contracted endpoint as use grows.
   Explain which provider receives searches/areas before submission.
2. Preprocess one pinned footprint release into locally served, spatially indexed
   extracts. Query only the selected bounds; do not download global partitions in
   the browser. Use bounded requests, cancellation, timeouts and explicit offline,
   no-data, too-large and retry states. No hidden cloud accounts or billing.
3. Extend the schema with source ID, dataset version/license, geometry origin,
   height source and review status. Preserve attribution through export. Keep
   sourced geometry separately identifiable from privately authored cameras/rooms.
4. Add a staged adapter from WGS84 to local meters, validated against the existing
   ±2 km domain. Explicitly handle Polygon/MultiPolygon, holes/courtyards and building
   parts. Current v1 supports only simple exterior rings: either extend the renderer
   and contract correctly or flag unsupported shapes for correction; never silently
   fill a courtyard. Guard vertex counts, invalid geometry and duplicate IDs.
5. Add licensed orthophoto preview and optional assisted segmentation only after
   the footprint flow has been evaluated. A local worker returns candidate polygons
   with provenance, never writes directly over a saved plan.

## Usability experiment and acceptance criteria

Compare three flows with novice facility staff: (A) area selection plus open
footprints, (B) area selection plus imagery-assisted outlines, (C) manual tracing
or private file import. Use facilities representing a simple warehouse, a multi-
building campus, a courtyard/connected-roof site and a site with missing/outdated
data. Recruit 5–8 representative users; no sessions have been conducted yet.

Measure unaided completion, time to an accepted shell, correction count, missing
or extra buildings, confidence in the result, and success when location is denied.
Proposed targets: 80% unaided completion, median under three minutes for a simple
site, and every user can identify which heights are estimates. These are targets,
not measured results. Select the default based on those observations, not visual
appeal alone. Refine failures and retest before calling the workflow validated.

- Every path can complete without location permission or a Google account.
- AOI confirmation, keyboard/numeric alternatives and cancel work before requests.
- Existing data survives failures, cancellation and invalid responses.
- Buildings require review before commit; one Undo restores the prior plan.
- Unknown source dates, heights and floors stay visibly unknown or estimated.
- Offline/no coverage offers manual construction or user file import.
- No Google imagery extraction, camera connection or identity inference is activated.

## Primary sources

- [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms), §3.2.3; current page last modified 2026-08-26.
- [Google service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), §20 Solar API; current page dated 2026-10-15.
- [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) and [Maps JS usage/billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing).
- [Google tile policies](https://developers.google.com/maps/documentation/tile/policies) and [3D renderer integration](https://developers.google.com/maps/documentation/tile/use-renderer).
- [My Maps shapes](https://support.google.com/mymaps/answer/3433053) and [KML export](https://support.google.com/mymaps/answer/3109452).
- [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints), current README/license. Its current direct license differs from the older Microsoft license listed on Overture's attribution page; use the chosen release's actual terms.
- [Overture Buildings](https://docs.overturemaps.org/guides/buildings/) and [theme licensing](https://docs.overturemaps.org/attribution/).
- [Google Open Buildings v3](https://sites.research.google/open-buildings/).
- [USGS NAIP](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip) and [USGS 3DEP data](https://www.usgs.gov/3d-elevation-program).
- [SAMGeo](https://github.com/opengeos/segment-geospatial) and [QGIS georeferencing](https://docs.qgis.org/3.44/en/docs/user_manual/managing_data_source/georeferencer.html).
- [W3C Geolocation](https://www.w3.org/TR/geolocation/) and [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).
