<div align="center">

# Intelligent DVR

**Connect deliberately. Review the evidence. Plan the space.**

![Conceptual isometric overview of a camera, saved clip, local review computer and editable floor plan.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/overview.jpg)

A local-first camera-analysis and facility-planning project from **BARTA AI Solutions**.

[📖 Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [🚀 First session](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started) · [🍎 Mac setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup) · [🖥️ PC setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) · [🧭 All guides](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki)

</div>

*The cover is an ImageGen illustration, not an application screenshot. The screenshots below are actual software with a clean local test session. [Image provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance).*

## Choose a launch path

| Your computer / task | Open this guide | Local address |
| --- | --- | --- |
| Apple silicon Mac, macOS 14+ | [Install → Check → Start](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup) | `http://127.0.0.1:4180/` |
| Linux or Windows PC | [Prebuilt kit or source setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) | `http://127.0.0.1:4173/` |
| Browser-only interface development | [Source preview](#run-the-source-only-ui-preview) | Address printed by Vite |
| An installed system ready for real-device testing | [Field acceptance runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance) | Your chosen stable local origin |

![Install, check readiness, then start the local app before deliberately connecting a camera.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/start.svg)

## See the current workspaces

| Monitor — start with one source | Train — one guided task at a time |
| --- | --- |
| ![Actual Monitor screen with webcam, local DVR and approved public webcam choices; no camera connected.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/monitor.jpg) | ![Actual Train screen with readiness, detection tuning and consent-based enrollment choices.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/train.jpg) |
| [Connect a source](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources) | [Tune detection](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training) · [Enroll with consent](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment) |

| Facility — build an editable plan | System — budget the workload |
| --- | --- |
| ![Actual Facility Studio with an explicitly fictional example plan for the guide.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.jpg) | ![Actual System workspace showing editable planning inputs, not measured host performance.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/system.jpg) |
| [Buildings, rooms, doors, windows and stairs](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) | [Resources and supported controls](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) |

*Controlled local captures from the merged PR #71 application source. The facility is a fictional built-in example. No private footage, enrolled people or surveyed site is pictured. [Full gallery and capture details](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas).*

## From one clip to a useful review

![Capture or import a selected clip, analyze it locally, then review and export the matched results.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recording.svg)

1. **Monitor:** choose a source and explicitly connect. For a webcam clip, deliberately record and stop it.
2. **Recognition:** import/select an approved recording, choose the local model and rules, then **Analyze recording**.
3. **Inspect:** read complete/partial coverage, sampled detections and the exact matched source.
4. **Events:** send observations deliberately, review the evidence, add notes and confirm/dismiss.
5. **Export:** save the report and the recognition-result/recording pair for reopening.

[Complete walkthrough](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook#3-analyze-a-clip) · [Review desk](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-and-events) · [Recording coverage](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage).

A camera preview does not run live AI. Detection scores are model outputs; sampled counts are not unique people or continuous tracking. Reports remain subject to human review.

## Make the tool fit your view

| Your goal | What to do | What the result means |
| --- | --- | --- |
| Reduce misses or false alarms for this camera | [Train → Start session](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training) | A threshold setting for this session; detector weights are not retrained |
| Review a possible enrolled-person match | [Get consent, enroll, then explicitly check a local job](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment) | A local suggestion for human confirmation, not proof of identity |
| Watch a specific image region | [Draw a zone on the correct still](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Zones) | A class-presence rule in that camera's image coordinates |
| Plan a building and cameras | [Facility: shell → floors → rooms/openings → cameras](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) | Editable proposed geometry and estimated coverage |
| Inspect image details or a measured plane | [Diagnostics](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics) · [Calibration](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration) | Explicit pixel/ground-plane checks with stated limits |
| Preserve work before updating | [Browser exports + private-folder backup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup#preserve-data-when-updating) | Separate copies of data that Git does not retain |

## Keep your work

![Export browser work, back up the private analysis folder, and verify a copy outside the checkout before updating.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/preserve.svg)

Browser reviews, rules, plans and session choices belong to the exact browser and origin. Models, recordings, tuned rule files and enrolled-person templates live in the private local service folders. Export temporary results before stopping the service; back up both storage areas separately. Keep the same browser and port for everyday work.

[Updates and migration](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup#preserve-data-when-updating) · [Saved facilities](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting).

## What is implemented and what still needs measurement

The current baseline includes explicit webcam/local DVR/approved public previews, bounded local recording analysis, human review and reports, guided threshold tuning, consent-based local face templates and possible-match suggestions, an editable facility planner and resource-planning controls. One configured LAN recorder has a separate explicit Start/Stop workflow.

**Physical-device endurance, independently measured detection/face-match quality, continuous multi-camera recording and 100-camera capacity remain unqualified.** Geometric coverage, sizing and route rehearsal are planning estimates. No subscription, paid inference or API key is required by the implementation; local hardware and storage still consume resources.

[Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Verification records](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation) · [Field acceptance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance) · [Data boundaries](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data).

## Run the source-only UI preview

Use Node.js 22 and npm from the repository root:

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

This starts the browser interface preview. Use the platform launcher for the local camera bridge, recording import, analysis and training APIs. [Mac](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup) · [PC kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing).

## Build toward 100 cameras

At least **100 simultaneously active cameras** is the owner's requirement. Connection count, recording continuity, analysis cadence and visible tiles are separate workloads. The fair bounded scheduler and synthetic load model prepare the engineering; they do not measure physical camera throughput.

[Performance preparation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan) · [Workload scope](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Pilot-scope) · [Hardware](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Hardware-guide) · [GPU planning](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning) · [Roadmap](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Roadmap).

## Documentation map

Begin with the [visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook), then use the [complete guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index). The [screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) distinguishes current controlled captures, explanatory graphics and the [historical visual tour](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour). The [GitHub Wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki) has its own published history and image assets; checked source mirrors live in [docs/wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Wiki-publication).

## Checks and project terms

```bash
npm run build
npm test
npm run test:sites
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
```

Use the platform's isolated dependencies for native checks; optional test fixtures require ONNX. [Verification](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation) keeps historical and current test scopes separate. PR #71's tested head passed 16 reported GitHub checks, including Mac source installation, Linux/Windows validation, the PC kit and controlled browser regressions; these are software checks, not field acceptance.

This repository does not currently assign a software license. Public availability does not grant a software license. [Third-party notices](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Third-party-notices) cover separately licensed components/models; [SECURITY.md](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Security-boundary) describes the prototype boundary. No pretrained weights, private recordings, templates or credentials are bundled.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/README.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
