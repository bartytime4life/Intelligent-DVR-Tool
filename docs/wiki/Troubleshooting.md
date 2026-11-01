# Find the next fix

[Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Mac setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup) · [PC setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) · [Field runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance)

![Install, check and start as three separate steps before connecting a source.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/start.svg)

Start with the readiness check for the same checkout you are launching.
**Check-Mac.command** checks the Mac source installation; PC **Check** uses the
Linux/Windows launcher. Check does not contact a configured camera.

| What you see | What to check next |
| --- | --- |
| Port 4180 is already in use | Open the existing Mac app, or stop its older terminal with Ctrl+C before launching this checkout. Keep the normal port/browser to retain browser saves. |
| Interface only / local analysis unavailable | Start the local service launcher and verify the Python environment, recordings folder and model catalog. Vite alone provides a browser preview. |
| Python dependencies missing or wrong version | Rerun the platform installer in this checkout; retain an incompatible environment and use a fresh folder if advised. |
| Model or catalog verification fails | Check the selected pinned files, SHA-256, relative paths, labels and compatible rules. Preserve the existing analysis folder while repairing it. |
| A camera preview is blank | Confirm the intended source, permission, device availability and receiving status. For DVR, verify the private host, port, credentials and RTSP path. |
| Public webcam fails | Confirm the provider-permitted direct HTTPS JPEG/MJPEG source and availability; HTML players/HLS are not bundled formats. |
| Recording cannot open or decode | Keep the original. Verify supported container/codec and a complete copy; analyze a separately converted copy when necessary. |
| Partial or unverified result | Read the coverage status and frame/time limits. Partial/unknown coverage is not complete coverage. |
| Browser playback fails after native analysis | The browser may not support that codec. Keep the original, convert a copy and analyze that new encoded file. |
| Overlay/result does not match a file | Select the exact analyzed source bytes. Re-encoding changes the hash and must not inherit old boxes. |
| Training Apply is disabled | Check `--allow-training` and successful local service readiness. A session does not overwrite detector weights. |
| Person enrollment is absent | Verify the two pinned face models and the enrollment-enabled launch path. Obtain consent before any capture. |
| Facility is blank or WebGL fails | A fresh plan is intentionally empty. Check browser WebGL support, then add a building or explicitly open an example. |
| A map request fails | Check the selected provider or use numeric coordinates/offline OSM import. Provider choice, search and tile loading are explicit actions. |
| Browser save fails or another tab changed the plan | Preserve exports and resolve the visible conflict/error before editing further. Do not reset storage to force a save. |

## Before reinstalling or moving folders

![Preserve browser exports, the private analysis folder and a verified backup outside the checkout.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/preserve.svg)

Export browser reviews, rules and facility plans separately. Export temporary
last-job results before stopping the service. Back up private recordings, models,
catalog, `trained/`, `people/` and source settings outside the checkout. Keep the
old installation until the new Check and the saved-data inspection pass.

The [service guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-analysis-service#limits-and-recovery) documents fixed
failure codes, deadlines and recovery. The [recording coverage guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage)
explains complete, partial and unverified outcomes. Physical compatibility and
recognition quality still require the separate [field runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/troubleshooting.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
