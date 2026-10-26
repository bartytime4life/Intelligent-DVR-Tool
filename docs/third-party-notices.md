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
