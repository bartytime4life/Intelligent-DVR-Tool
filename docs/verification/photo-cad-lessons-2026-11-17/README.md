# Targeted Photo to 3D CAD lessons applied to DVR

Date: November 17, 2026. Base: `9dfba23` (`origin/main`, refreshed before editing).
Branch: `codex/photo-cad-lessons-20261117`.

The applicable lessons were source-bound results, reversible inspection, visible
recovery and keyboard-accessible controls. The existing tracker, detector and GPU
defaults were retained: no measured model improvement justified replacing them.

## Reproductions and changes

| Reproduced baseline behavior | Change |
| --- | --- |
| Clear frames during an image decode, then finish the decode: the cleared image returns | Import generations retire cleared, cancelled, superseded and unmounted results; late bitmaps still close |
| Inspect A, import B, return to A: the region has been replaced by B's inspection | Each frame retains its own region and pixel ruler; replacement resets only its destination |
| Tab from Open local image: focus lands on its invisible file input | Proxy inputs leave the tab sequence; both visible buttons still open the native chooser with Enter |
| Cancel an address or footprint request after headers while the body stalls: the read stays pending | Pass the same deadline/cancellation signal through the body reader; cancel it and release the lock |
| Failed or declared oversized replies retain their downloads; cleanup errors can mask size failures | Cancel rejected bodies before parsing, enforce declared and actual size, and retain original errors |

Before the patch, four new Node cases failed and three of the initial four Chrome
cases failed. The fourth Chrome case verified that camera selection already
remounts its diagnostics; that code was preserved. Additional cases cover explicit
import cancellation, a newer image and its actual JSON download, and stale decode
errors. Test images are generated 16 × 16 PNGs, never owner footage.

## Validation

- Full `npm test`: **694 passed, 2 skipped**, no failures (696 tests).
- Focused Node suite: **33 passed** (`facility-services`, `facility-starter`, `image-science`).
- Production build and Sites worker checks passed; Vite retains its existing large-chunk warning.
- Affected installed-Chrome suites: **28 passed**, including desktop/phone Studio and calibration cases.
- After adding an explicit A/B ruler-preservation assertion, all **6** new recovery cases passed again.
- Documentation link/media checks and exact generated Wiki checks passed (68 generated pages/navigation files); `git diff --check` passed.

The [source fingerprints](source-hashes.json) bind the three changed production
files and two regression files to these checks. Existing physical/installed
evidence was checked by the documentation tooling, not rerun or superseded.

Commands for the affected browser suite (installed Chrome, no physical camera):

```sh
DVR_BROWSER_CHANNEL=chrome node_modules/.bin/playwright test \
  --config=playwright.facility.config.mjs \
  tests/browser/image-diagnostics-recovery.spec.mjs \
  tests/browser/facility-studio.spec.mjs \
  tests/browser/facility-map-draft-preservation.spec.mjs --reporter=line
```

This checkout reused the existing local Playwright installation. Browser cases
block external network requests or provide fixed route fixtures. The suites cover
generated images, actual local JSON downloads, existing calibration gates, phone
and desktop Studio layouts, and explicit map draft application/discard. They do
not qualify live providers, real camera imagery, recognition accuracy, CUDA,
100-camera capacity, installed applications or deployment. Wiki mirrors are
generated locally; no Wiki publication is part of this change.
