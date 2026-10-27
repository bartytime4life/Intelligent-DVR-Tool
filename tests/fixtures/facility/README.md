# Recorded OSM exterior regression data

© OpenStreetMap contributors. This derived database is made available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Individual contents are subject to the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).
Attribution and source access: https://www.openstreetmap.org/copyright.

These are historical, openly published exterior footprints, not owner locations,
camera plans, operational footage, surveyed measurements or current imagery.
`manifest.json` pins upstream Git commits, original file paths, SHA-256 hashes
and transformations. JSON files here are derived extracts rather than byte-for-byte
copies of upstream files. The upstream source hashes describe the original UTF-8
files. The fixture hashes describe the derived JSON files, with LF endings.

- `eppan-exteriors.json`: two complete anonymous exterior ways near Eppan/Appiano,
  from a 2014 OSM snapshot. No occupancy or use is inferred. Expected: two shells.
- `eppan-courtyard.json`: public church outline and its courtyard parent relation
  from the same snapshot. Expected: zero shells; the outer way remains excluded.
- `recorded-block.json`: three historical exterior ways and a courtyard relation
  from an independent recorded OSM block. Private address fields and contributor
  account metadata are removed. Expected: three shells and one excluded relation.

The transformation resolves node references using only nodes actually supplied
in the upstream extract. Missing coordinates are never filled or interpolated.
Public-source test geometry does not establish field accuracy or present occupancy.
The application bundle does not import these fixtures.
