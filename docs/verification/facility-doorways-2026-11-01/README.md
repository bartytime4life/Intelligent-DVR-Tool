# Shared-wall doorways · local verification

November 1, 2026. Unpublished working tree on base commit
`3e074462cdbdb008f6d85455d7d7acb5f32dc214`. This includes the preceding
building/indoor editing work; it is not a merged-release or physical-site claim.

## Checks

- `DVR_TEST_SOCKETS=1 npm test`: 270 passed, no skips. Doorway geometry checks
  cover collinear and rotated walls, fitting and overlap rejection, v4 export
  round trips, lintels and estimated rays, room splits/merges/wall moves,
  building transforms, origin changes and floor copying.
- Chromium: 15 passed across `facility-doorways.spec.mjs`,
  `facility-room-sketch.spec.mjs`, `facility-room-walls.spec.mjs` and
  `facility-geometry.spec.mjs`. The four doorway scenarios passed again after
  disabling drag handles while dimension inputs are invalid. They exercise
  actual map clicks, mouse/touch dragging, Escape, arrow keys, save/reload,
  Undo/Redo, feet, copying floors, numeric editing without WebGL and room-to-opening
  conversion. Test plans are isolated from the owner's browser saves.
- `npm run build`: passed; Sites client/server/config outputs created.
- `npm run test:sites`: 4 passed. Packaging source files remain unchanged.
- `python3 scripts/check-docs.py` and `git diff --check`: passed.

Browser command: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npm run
test:facility:browser --` followed by the four `tests/browser/` paths above.
These are local software-fixture checks. No cameras, provider requests,
recognition jobs, novice participants or field measurements were used.

## Final source bindings (SHA-256)

```text
dee737c4c8bdc7bce497ae7c4d82be0a76e45f2a132804f9b911cfc4d7c994fd  src/facility-doorways.mjs
87e124d0b94457578876c4eba0d3adf9079aa7401977a4b88077b5aaa8f87d25  src/facility-doorway-map.mjs
b3288da4cecce0e5ae182dfdd9099393f995430d77bc91ee9bd3c1ee2ba3df8b  src/FacilityDoorways.jsx
c4aa9bd01ab0e6f85ebbbe73bf46635af062789da31b75e42ce970b60a326ae1  src/FacilityBuilder.jsx
47341c8edd648f920706d7db47f64529c8490e2613ff32b7a19a4fdccb8f9262  src/facility-map.mjs
aeee416223f49873fc6c0acdc3774c0c42971bb679ac41dd3919cb4833505861  src/facility.mjs
```

Usage and limitations: [facility builder](../../facility-builder.md).
