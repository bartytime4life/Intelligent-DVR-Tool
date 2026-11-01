# Third-party components

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual asset provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance) · [Project terms](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home#checks-and-project-terms)

- Phosphor React icons: https://github.com/phosphor-icons/react — MIT.
- Inter font: https://github.com/rsms/inter — SIL Open Font License 1.1. The Latin
  variable subsets from `@fontsource-variable/inter` 5.3.0 are bundled in
  `src/vendor/fonts/` with [the license](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/public/licenses/inter-LICENSE.txt).
- React / React DOM: https://github.com/facebook/react — MIT.
- Vite: https://github.com/vitejs/vite — MIT.
- Optional OpenCV Python: https://github.com/opencv/opencv-python — see upstream
  wheel notices, including bundled components; OpenCV uses Apache-2.0.
- Optional NumPy: https://numpy.org/ — BSD-3-Clause; bundled notices may apply.
- Optional PyAV recording validator: https://github.com/PyAV-Org/PyAV — see its
  BSD-3-Clause license and the FFmpeg/library notices supplied in each installed wheel.
  The PC runtime pins 19.0.2; no native runtime binaries are vendored in this repository.
- Optional ONNX (synthetic integration tests only): https://onnx.ai/ — Apache-2.0.

Model weights and training datasets are not included; their licenses and
commercial use conditions require separate review. Generated sample camera
scenes are not evidence of real events.

The explicit optional CUDA environment adds ONNX Runtime GPU 1.31.1
([upstream](https://github.com/microsoft/onnxruntime/tree/v1.31.1)) and NVIDIA
CUDA/cuDNN/math runtime wheels. These are separate installed dependencies;
no runtime binaries or model weights are vendored by this change. Preserve
the licenses/notices included in each installed wheel. NVIDIA components have
their own vendor agreements, including the CUDA Toolkit and cuDNN SDK terms;
the repository does not relicense them. Exact dependency versions and usage
limits are in the [CUDA operator guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Edge-CLI#optional-explicit-cuda-backend)
and [qualification record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/cuda-2026-10-28/README.md).

The optional OpenCV Zoo YOLOX-S candidate and its COCO80 class ordering are
documented in [model qualification research](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Model-qualification-2026-10-26).
The exact model directory states that all its files use Apache-2.0. The upstream
license is preserved in [Apache-2.0-YOLOX.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/model-qualification/Apache-2.0-YOLOX.txt).
Class names were transcribed from the pinned upstream demo; no trained weights
or upstream runtime implementation are bundled. This third-party notice does
not assign a license to BARTA's repository.


## Facility editor

- MapLibre GL JS 6.9.0 — BSD-3-Clause; full upstream combined notice:
  [maplibre-gl-LICENSE.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/public/licenses/maplibre-gl-LICENSE.txt).
- Three.js 0.186.1 — MIT:
  [three-LICENSE.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/public/licenses/three-LICENSE.txt).
- Terra Draw 1.38.0 and MapLibre adapter 1.5.0 — MIT, upstream commit
  `18ca034880232b8b618ef1ca843d8e0b6c82f1ab` from
  https://github.com/JamesLMilner/terra-draw. Compiled source snapshots are in
  `src/vendor/`; both retain full MIT headers. Full notice:
  [terra-draw-LICENSE.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/public/licenses/terra-draw-LICENSE.txt).
- Room sketch includes polygon-clipping 0.15.7 (MIT), splaytree 3.2.3 (MIT)
  and robust-predicates 3.0.3 (Unlicense). Their complete upstream notices are
  in [room-sketch-LICENSE.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/public/licenses/room-sketch-LICENSE.txt).
- The optional Streets map layer uses OpenStreetMap data and tiles. Visible
  attribution is supplied when enabled. Data and hosted tile-service terms are
  separate from the renderer license; see https://www.openstreetmap.org/copyright
  and https://operations.osmfoundation.org/policies/tiles/.
- The optional Aerial map layer displays USGS The National Map orthoimagery
  (`USGSImageryOnly` tiles) and USDA Farm Service Agency NAIP imagery served by
  the USGS `USGSNAIPImagery` image service. These U.S. Government works are in the
  public domain; while the layer is shown the map displays the acknowledgment
  USGS requests ("Map services and data available from U.S. Geological Survey,
  National Geospatial Program") and credits USDA NAIP. See
  https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map
  and https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits.
  No imagery is bundled or cached to disk.

The editable sample facility is fictional. No person identity, trained association model or real camera recording is bundled here. Historical OSM exterior extracts are included only in the regression fixtures described below.

## Facility setup data and optional services

The historical OSM regression extracts in `tests/fixtures/facility/` are
© OpenStreetMap contributors, licensed under ODbL-1.0. Their exact upstream
commits, transformations and hashes are in `manifest.json`; the database notice
is in `README.md`. These extracts are test data and are not loaded into the app
or used as evidence of current dimensions. Source OSM data remains under ODbL,
separate from the converters' software licenses.

Optional submitted address search uses Photon, an Apache-2.0 geocoder for OSM
data. No Photon code or database is bundled. Public demo terms and OSM credit
are linked beside search. Private deployment can serve a local Photon instance.
See [facility setup reliability](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-reliability) for service limits,
privacy and source evaluation. Public Nominatim is not used by this app.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/third-party-notices.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
