# Third-party components

- Phosphor React icons: https://github.com/phosphor-icons/react — MIT.
- Inter font: https://github.com/rsms/inter — SIL Open Font License 1.1.
- React / React DOM: https://github.com/facebook/react — MIT.
- Vite: https://github.com/vitejs/vite — MIT.
- Optional OpenCV Python: https://github.com/opencv/opencv-python — see upstream
  wheel notices, including bundled components; OpenCV uses Apache-2.0.
- Optional NumPy: https://numpy.org/ — BSD-3-Clause; bundled notices may apply.
- Optional ONNX (synthetic integration tests only): https://onnx.ai/ — Apache-2.0.

Model weights and training datasets are not included; their licenses and
commercial use conditions require separate review. Generated sample camera
scenes are not evidence of real events.

The optional OpenCV Zoo YOLOX-S candidate and its COCO80 class ordering are
documented in [model qualification research](model-qualification-20261026.md).
The exact model directory states that all its files use Apache-2.0. The upstream
license is preserved in [Apache-2.0-YOLOX.txt](model-qualification/Apache-2.0-YOLOX.txt).
Class names were transcribed from the pinned upstream demo; no trained weights
or upstream runtime implementation are bundled. This third-party notice does
not assign a license to BARTA's repository.


## Facility editor

- MapLibre GL JS 6.9.0 — BSD-3-Clause; full upstream combined notice:
  [maplibre-gl-LICENSE.txt](../public/licenses/maplibre-gl-LICENSE.txt).
- Three.js 0.186.1 — MIT:
  [three-LICENSE.txt](../public/licenses/three-LICENSE.txt).
- Terra Draw 1.38.0 and MapLibre adapter 1.5.0 — MIT, upstream commit
  `18ca034880232b8b618ef1ca843d8e0b6c82f1ab` from
  https://github.com/JamesLMilner/terra-draw. Compiled source snapshots are in
  `src/vendor/`; both retain full MIT headers. Full notice:
  [terra-draw-LICENSE.txt](../public/licenses/terra-draw-LICENSE.txt).
- The optional online street map uses OpenStreetMap data and tiles. Visible
  attribution is supplied when enabled. Data and hosted tile-service terms are
  separate from the renderer license; see https://www.openstreetmap.org/copyright
  and https://operations.osmfoundation.org/policies/tiles/.

The editable sample facility is fictional. No external building model, person
identity, trained association model or real camera recording is bundled here.
