# Exterior windows · local verification

Unpublished working tree on `3e074462cdbdb008f6d85455d7d7acb5f32dc214`, November 1, 2026. [Operator instructions](../../facility-builder.md).

| Local check | Result |
| --- | --- |
| `DVR_TEST_SOCKETS=1 npm test` | 274 passed, none skipped. Includes perimeter and courtyard geometry, anchored resize, corner and neighbor stops, wall sections, floor copying, transforms, and facility v5 import/export. |
| Chromium, `facility-windows`, `facility-doorways` and `facility-geometry` specs | 11 scenarios passed. The seven window and doorway scenarios passed again after the final mobile save and floor-switch changes. |
| `npm run build` and `npm run test:sites` | Production build passed, all three Sites outputs present; four worker checks passed. |

The browser checks click an exterior wall, drag the center and both ends, cancel
a drag, change window height in elevation, save, export, reload, Undo/Redo,
and verify upper-floor numeric entry without WebGL. A 390 px Chromium viewport
with touch input exercises resize, map Save and adding another window. Test data
lives in isolated browser contexts. These are software checks, not a survey,
physical-device acceptance or measurements of visibility through glass.

Final window implementation fingerprints (SHA-256):

```text
84cc16197f284680b86edb77b8fd6d49bdc53bb11c316b87332774879cac7ff4  src/facility-windows.mjs
0abc5aa5ae9446d2e47fc72dfe3e3fff113bcc2f4a321b79b32d73cb66364d6a  src/facility-window-map.mjs
75201f783324fee18ea15e2c4d3f683d742921e521d0eaac33fae438417f0726  src/FacilityWindows.jsx
```
