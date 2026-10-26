# Five-camera pilot and service scope

## Service area

Computer vision, object detection and scene review are a **proposed custom-tool
and workflow service area**. This repository is the prototype. It does not
establish production availability, a fixed price, camera support, savings or
a service commitment on BARTA's public website.

## First useful workflow

An operator reviews a class/zone/duration observation, checks the recording,
and records a decision. “Out of place” must become a written rule tied to a
location, object class, time requirement and known failure modes. Nothing in
this prototype determines identity, intent or whether someone is authorized.

## Scope to agree before connecting cameras

| Item                | Required evidence                                                                     |
| ------------------- | ------------------------------------------------------------------------------------- |
| Task                | One recurring inspection/review task and the operator's response                      |
| Cameras             | Make, model, firmware, protocol, codec, resolution, FPS and permission                |
| Edge hardware       | CPU/GPU, RAM, thermals, storage and network budget                                    |
| Targets             | Exact model classes, normal scenes, zones and permitted times                         |
| Training/evaluation | Approved collection, consistent labels, provenance and held-out recordings            |
| Timing              | Agreed maximum event delay; measured capture-to-review p50/p95 under five-camera load |
| Quality             | Per-class precision/recall, missed events and false alerts per camera-hour            |
| Review              | Named operator role, evidence handling, retention and escalation rules                |
| Commercial          | Hardware, storage, support and third-party costs; no assumed savings                  |

## Engineering sequence

1. Validate the UI workflow on generated samples and approved local footage.
2. Qualify a licensed model/export on labeled held-out recordings; record hashes.
   Start with the [model research and compatibility-only evidence](model-qualification-20261026.md).
   A synthetic-input pass does not complete this step.
3. Implement a credential-protected, allowlisted camera adapter on an edge host.
   No credentials or RTSP URLs should reach the hosted frontend or repository.
4. Add bounded capture queues with drop/backpressure reporting, reconnection,
   per-camera health, storage/retention limits and measured end-to-end latency.
5. Test one camera, then the five-camera pilot, including disconnects, low light,
   occlusion, camera movement, empty scenes and resource contention.
6. Agree the remaining scope and support before any operational reliance.

## Architecture boundary

The browser is a review workspace. The Python tool operates offline on a local
recording with an owner-supplied model. Receipts bridge the two through explicit
metadata import; no network ingest endpoint exists. Sites hosting can serve the
workspace later; it is not an RTSP capture host or a low-latency inference claim.
No OpenAI API integration is included. Any later optional cloud scene description
needs a separate transmission, cost and data-handling decision.

## Known limitations

- Continuous class presence is not same-object tracking or learned anomalies.
- Imported receipts are unsigned; UI review storage is local and editable.
- No camera adapter, trained weights, model-quality benchmark or live deployment.
- Video preview and simulated playback must not be described as AI analysis.
- Browser zones and edge-rule files use separate explicit schemas.
