# Recording coverage and incomplete decoding

A failed OpenCV `read()` does not distinguish EOF from a decoder error. A
controlled regression returned seven frames from a generated 30-frame source
and previously published `state: completed`. New analysis validates an alleged
end-of-file before publishing a completed result.

## What the check establishes

After inference releases its OpenCV capture and model backend, a separate local
PyAV pass strictly decodes the selected video track. It checks corrupt packet/
frame flags and decoder errors, requires the same decoded frame count, and
compares available reported frame-count and/or duration inventory. One additional
frame already proves the analyzer stopped early, so validation decodes at most
the observed frame count plus one. Dummy demux packets are decoded to flush
delayed frames, including B-frames.

The original file is not rewritten. Source/model/labels/rules hashes are checked
before and after analysis, including receipt-only and trace-only calls. Native
validation reads a binary local file with an explicit AVI, Matroska/WebM or
MOV/MP4 demuxer, file-only protocol access and disabled external MOV references.
Exactly one video track is required; audio is ignored. Container duration is not
used as a video-duration anchor when another track might run longer. Resolution
and source-byte bounds remain 4K pixels and 512 MiB.

This is an inventory/decoder agreement check, **not proof that every byte is
intact, metadata is truthful, or all original camera footage was captured**.
PyAV and OpenCV both use FFmpeg libraries; they are separate decoding passes,
not independent codec implementations. Self-consistently rewritten/truncated
media or undetected codec damage can escape these checks. Source authenticity,
camera completeness, receive-time continuity and recognition quality remain
separate. Existing nominal-FPS timestamps are unchanged by this fix.

## Outcomes

| Condition | Result |
| --- | --- |
| Full strict decode agrees with analysis and a reported inventory anchor | `completed`, with `inventory-matched` coverage |
| Strict decode finishes but no usable frame-count/duration anchor exists | `partial`, explicitly `recording completeness unverified` |
| Analyzer reaches its configured frame or observation cap | `partial`, with that limit named; full validation is not claimed or run beyond the cap |
| Validation finds more frames than the analyzer processed | `MEDIA_INCOMPLETE`; no receipt, trace or review published |
| Corrupt packets/frames or strict-decoder failure | `MEDIA_CORRUPT`; no result published |
| Decode counts or available duration inventory disagree | `MEDIA_INVENTORY_MISMATCH`; no result published |
| Unsupported local media/track layout or missing validator dependency | Actionable `MEDIA_UNSUPPORTED` / `MEDIA_DEPENDENCY`; no completed result |

The local job's terminal `completed` means processing finished. Its separate
`result_state` and the Recognition coverage label describe whether coverage is
complete or partial. Failed validation preserves the current browser review,
refuses result download, and allows an explicit retry. Worker diagnostics expose
only an allowlisted code and fixed message, never native errors or paths.

Recorder-owned segments retain their existing source/timing fingerprint and
producer frame-inventory checks before accepting a result. Interrupted jobs
still recover as interrupted, never restart automatically. Legacy saved results
remain readable and are labeled **recording coverage unverified**; reopening a
historical `completed` result does not retroactively validate its source.

## Metadata and resource scope

New receipts and traces share `media_coverage` with schema
`intelligent-dvr.media-coverage.v1`. It binds source hash, analysis/validation
frame counts, termination, reported frame/duration metadata, decoded duration,
the duration tolerance, anchor and validator version. Duration tolerance is half
the decoded timestamp tick, with a one-microsecond numerical allowance. Missing
or contradictory declarations fail validation. These are unsigned declarations.

Recognition and printable/JSON reports distinguish unknown completeness, legacy
coverage, frame limits and observation limits. Observation CSV includes coverage
status and termination. The offline evaluator checks new declarations and still
rejects partial traces; historical traces retain explicit null coverage metadata.

PyAV 19.0.2 is pinned in the Python 3.12 PC qualification runtime; the generic
optional edge requirements permit compatible PyAV 16–19 releases. The installer
uses binary wheels and its bounded native readiness probe validates generated
AVI coverage without contacting cameras. An older installation needs its current
runtime requirements installed before new recording analysis is available.

Validation shares the existing local service worker's five-minute wall deadline,
4 GiB address-space/process-memory bound and Linux CPU limit. Cancellation and
parent-loss cleanup remain enforced. Validation time is included in job elapsed
time, not detector-only latency percentiles. No separate service or GPU worker
is introduced. The standalone CLI retains its existing lack of a hard native
wall-time deadline; use the bounded local service for that enforcement.

## Verification and remaining work

Generated native checks cover healthy AVI/WebM/MP4, MPEG-4 B-frame flushing,
early OpenCV stop, actual truncation, last-frame loss, absent inventory metadata,
bounded validation, explicit caps, source preservation, safe worker failures,
retry and Linux recovery. Browser tests cover native corrupt-media failure/retry,
unverified versus limit explanations and legacy results. These establish software
behavior, not physical-camera acceptance or detection accuracy.

Next work remains full-quality source preservation, visual enhancement comparison
and reviewed labeling. This fix does not change recorder sampling/re-encoding,
infer missing timestamps, enable a camera, install restoration weights, replace
the owner's running application or qualify continuous/100-camera operation.

Implementation references consulted: OpenCV's
[VideoCapture read contract](https://docs.opencv.org/4.10.0/d8/dfe/classcv_1_1VideoCapture.html),
PyAV's [demux/flush API](https://pyav.basswood.io/docs/stable/api/container.html)
and [frame timing/corruption flags](https://pyav.basswood.io/docs/stable/api/frame.html),
and FFmpeg's [decoder error-detection options](https://www.ffmpeg.org/ffmpeg-codecs.html).
They informed explicit EOF handling, delayed-frame flushing and strict error
detection; none establishes perfect corruption detection or field compatibility.
