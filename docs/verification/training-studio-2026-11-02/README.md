# Guided training verification

The November 2 Linux checks exercised Train from camera permission through local analysis, comparison, explicit saving, and reopening Recognition. Browser scenarios used generated camera input. A physical camera and independently labeled room footage are still required to measure performance for a particular installation.

| Check | Observed result |
| --- | --- |
| Input-dependent synthetic ONNX detector | Actual local inference on two separate generated recordings. On the fresh clip, thresholds 0.70 and 0.40 found 0/32 and 32/32 in-view samples respectively. Each flagged 0/25 empty-view samples. |
| Operator decision | The test confirmed the scripted conditions and selected Apply. The service received one rule write. After reload, Recognition selected the exact detector and saved rule. A separate equal-count scenario kept the current setting with zero rule writes. |
| Pinned pretrained detector | OpenCV CPU executed YOLOX-S on Chromium’s generated pattern. Calibration sampled 162 frames. At 0.50 there were zero person detections in 107 in-view-prompt checks and 29 empty-prompt checks. Train proposed no threshold change. A separate 60-sample recording reached the confirmation screen. The exercise ended before confirmation. |
| Timing | Both browser clips in the improved comparison used decoded presentation timestamps. The strict decoder reached source end. The WebM files lacked an independent header inventory, recorded as unverified coverage. Variable-frame-rate and clock-mismatch regression cases exercised the separate timing gate. |
| Local software checks | 451 Python tests, 313 frontend tests and four packaging tests passed. All 18 analysis-browser scenarios passed across isolated local runs. The production build, documentation checks, and Wiki mirror checks passed. |
| PC startup | The Linux Train launcher served the built interface using a prepared pinned model with zero configured camera channels and zero active jobs. Windows argument routing and PowerShell syntax were checked locally. Physical Windows installation remains unverified. |

The [synthetic comparison receipt](synthetic-comparison.json) comes from the scorecard's JSON export. Its source hashes identify the generated clips and its two columns use the same scored samples. The [pretrained detector receipt](pinned-detector-smoke.json) separately identifies the real model, execution backend, served browser asset, and observed counts. The controlled detector was designed to respond to brightness. Its improvement measures the software's behavior under known inputs.

To repeat the software checks from a prepared checkout:

```bash
npm run build
DVR_TEST_SOCKETS=1 npm test
npm run test:sites
DVR_TEST_SOCKETS=1 python -m unittest discover -s tests -p 'test_*.py'
npx playwright test --config=playwright.analysis.config.mjs
python scripts/check-docs.py
python scripts/build-wiki.py --check
```

The browser workflow uses a generated camera, two generated test models and a temporary recordings folder. The operator procedure for a real camera is in the [training guide](../../training.md).
