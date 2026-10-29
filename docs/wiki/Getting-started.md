# Your first five minutes

Current Monitor setup: [connect a webcam or local DVR](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-camera-feeds.md).
It starts empty; generated scenes and default sample events from earlier
walkthroughs are no longer shown. [Recognition](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-analysis-service.md) can
run local recording jobs directly. Earlier screenshots below are historical.


[Home](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home) · [Visual tour](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour) · [Architecture](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data)

For OS-specific launchers and machine sizing, use [Linux setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Linux-setup), [Windows setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Windows-setup) and the [hardware guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Hardware-guide). **System** in the main navigation opens the machine planner and resource-policy controls.

## Start locally

The current JavaScript checks use Node.js 22. Install with the lockfile, then start a loopback-only development server:

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

Open the address Vite prints. The default workspace has generated scenes and simulated observations. No camera setup, account, API key or subscription is needed. These commands do not download a trained model.

For a production-package smoke check:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

This is a local preview, not an authenticated monitoring service or a public-deployment recommendation. The build retains Sites-ready Worker packaging; packaging success does not establish a hosted deployment.

## Walk through the program

| Step | Do this | Look for |
| --- | --- | --- |
| 1 · Monitor | Expand a camera, close it, toggle overlays, select another source | SAMPLE labels, tile controls and separate review queue |
| 2 · Review | Open a sample event, add a note, confirm or dismiss | A saved decision and updated queue |
| 3 · Events | Search/filter history and export reviews | Source distinctions and your recorded decision |
| 4 · Zones | Adjust numeric rectangle fields, save a rule, try a simulated event | Explicit geometry, label, dwell and threshold |
| 5 · Facility | Inspect the sample, add a shape, Undo, inspect a camera, scrub Handoffs | Estimated coverage, simulated route and visible gaps |

![Actual sample observation review dialog.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/review.webp)

## Preserve your work

The workspace uses browser localStorage for sample decisions/rules and the facility plan. Use **Export reviews**, **Export browser rules** and **Export plan** for separate copies. Store downloads somewhere you control; site storage is not a backup or shared audit system.

Facility import validates before replacement, and Undo can restore the previous edit. Keep camera credentials and footage out of metadata. The [facility guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) documents bounds and source fields.

## Try a local video or offline receipt

For actual sampled detections on matching footage, use the new **Recognition**
workspace and [recording recognition pilot](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/recording-recognition.md). The analyzer
creates a review bundle; the browser verifies your original file before overlaying
boxes. This is separate from the sample Monitor and simple video preview below.

Settings can preview an explicitly selected local video without uploading it. Preview does not analyze the video. To analyze an approved recording, use the separate [edge CLI](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/README.md), a deliberately obtained compatible model and verified labels, then explicitly import its review receipt.

An evaluation report is **not** a review receipt. `intelligent-dvr.evaluation.v1` belongs to the evaluation path; the browser imports `intelligent-dvr.receipt.v1`. Imported observations do not acquire generated sample imagery.

## Maps and location

Facility opens with a local grid. In **Locate site**, expand **Find an address or place**, choose a disclosed public/local provider, enter text and submit **Search address** (or Enter). Nothing is sent while typing. Select a suggestion, review coordinates and **Save site**. **Use my location** offers a one-shot position and accuracy; numeric coordinates remain available. Saving a changed origin relocates the whole existing plan.

Review the bounded rectangular area, choose a building source and **Load open building drafts**, or use **Offline OSM file** / paste a complete Overpass JSON extract. Review selected shells and height/floor assumptions before applying. **Add to existing plan** preserves cameras/rooms; **Replace with a clean site** clears them explicitly. Undo restores the prior plan.

Online street tiles, address search and draft loading are separate actions. Public services receive submitted text or selected bounds; local choices require operator configuration. An offline extract with manually entered coordinates avoids those two provider requests. Unknown heights/floors can be placeholders; interiors are not inferred. [Map starter](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Maps-and-shapes) · [Recovery and test limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-reliability).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Facility cannot render | A working WebGL-capable browser is required; inspect its visible error and preserve the plan export |
| Online map/building request fails | Keep the local grid or use an offline extract; provider availability varies |
| Address search or location fails | Enter coordinates manually and use an offline extract; a local provider works only after operator configuration |
| Plan import fails | Check its validation message and [bounded contract](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning#bounds-and-capacity) |
| Another browser lacks your edits | Data belongs to the browser and origin; import an exported copy |
| Native Python checks skip | Install `edge/requirements-test.txt` in isolation; retain skip counts in reports |

Room drawing currently requires a pointer. Numeric building/camera controls do not remove that accessibility gap. The later [facility regression suite](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-27/README.md) includes a narrow viewport and keyboard search with mocked services. Full mobile, screen-reader, room-drawing keyboard and long-session acceptance remain separate work.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/getting-started.md) · Documentation refresh: October 28, 2026.
