# Intelligent DVR Tool

An edge-first camera-analysis pilot for BARTA AI Solutions. The first working
version combines a polished five-camera sample workspace with explicit zone
rules, human review, local video preview and an optional offline ONNX adapter.

**Status:** functional review prototype and analysis foundation. No real cameras
are connected. No trained detector, deployment, real-time performance, detection
accuracy or camera compatibility is claimed.

## Start the review workspace

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 4173
```

- **Monitor:** four-view wall, five selectable camera sources, sample scrubbers,
  overlay visibility and expanded camera view. Playback is simulated over stills.
- **Events:** confirm or dismiss observations with notes; filter, search and
  export review history. Imported offline observations never borrow sample images.
- **Zones:** draw rectangular zones or use numeric geometry controls, choose
  sample labels, duration and score threshold; save and try a simulated event.
- **Settings:** preview a local video without upload, import an edge receipt,
  inspect pilot boundaries or reset browser data.

Sample decisions and rules persist in localStorage on this browser. They are
not multi-user records or a tamper-evident audit log. Clearing site storage
removes them. Exports are explicit. No remote backend, cloud inference, database,
camera credentials, subscription or API key is required by the workspace.
The optional Inter font uses Google Fonts; the system fallback works offline.

See [edge/README.md](edge/README.md) for the recording-analysis CLI, supported
ONNX contract, scope limits and receipt format. See
[docs/pilot-scope.md](docs/pilot-scope.md) for qualification and service scope.

## Checks

```bash
npm test
npm run build
python3 -m unittest discover -s tests -p 'test_*.py'
```

Pure rule tests require only Python. For synthetic inference integration install
`edge/requirements-test.txt` in an isolated environment; otherwise those tests
are explicitly skipped. `npm test` also checks the retained Sites-ready Worker
packaging. This repository is prepared for a later private Sites deployment;
no Site is registered or published by this implementation.

## Assets and design

The owner selected the dark monitoring-wall concept, with additional polish.
Five synthetic camera scenes were generated for this project. They are sample
imagery, not a record of any real workplace. Icons: Phosphor, MIT license.
The selected concept guides the layout; the app is editable React and CSS,
not a screenshot pasted into a page.

The repository does not assign a software license on the owner's behalf.
Third-party notices are in [docs/third-party-notices.md](docs/third-party-notices.md).
