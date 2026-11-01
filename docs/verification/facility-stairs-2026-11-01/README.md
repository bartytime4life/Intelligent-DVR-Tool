# Stair placement · local verification

Unpublished working tree based on `3e074462cdbdb008f6d85455d7d7acb5f32dc214`, November 1, 2026. [Operator guide](../../facility-builder.md).

The floor-map tool reserves one straight flight with two landings. The clicked
point is the center of the departure landing. Saved positions remain center-based
and the bearing always points uphill, including when the chosen trip goes down.
Changing the destination proposes a new riser count; rotating and changing floors
preserve the departure point. Floor cutouts remain independent edits.

- `DVR_TEST_SOCKETS=1 npm test`: 278 passed, none skipped. Includes pivot and
  direction changes, ascending tread geometry on descending trips, multi-level
  persistence, legacy input, solid landing checks and suggested positions.
- Six stair browser scenarios passed with isolated facility data, Chromium and its WebGL renderer,
  a 390 px touch viewport, and a separate context without WebGL. The scenarios
  cover desktop placement/movement/rotation, cancel, keyboard editing, save,
  reload, export, Undo/Redo, descending touch placement, and exact entry with
  graphics disabled. Legacy coverage includes feet entry, draft guards, floor
  and ceiling cutouts, and whole-floor toggles.
- Production build and all four Sites worker checks passed, including the three required package outputs.

This checks the software geometry and inputs. It does not establish real-device
acceptance, measured headroom, survey accuracy or construction suitability.

Implementation fingerprints (SHA-256):

```text
4ce62cab36971dd528a4af8667168e6cc39f723e5aecbfc619e091106c05a544  src/facility-stairs.mjs
a49998aeb66bc1bfe1bef2ada74141b1f9c0c076990b506a9a2683034c69221a  src/facility-stair-map.mjs
c4cab8aea847a30cc14c2af8e6dbece4a29cdb1e329addb8f2679bf0a6315be2  src/facility-stair-placement.mjs
b96d1c6806c529b402d646eb2112c719a017174d4b4d9da5670c12895331f0ee  src/FacilityStairs.jsx
```
