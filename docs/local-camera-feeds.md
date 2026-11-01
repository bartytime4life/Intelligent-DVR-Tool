# Local webcam and DVR previews

[Current image gallery](visual-atlas.md) · [Setup for PC](pc-testing.md) · [Recording and review](recording-workflow.md)

![Current Monitor interface in the controlled browser run: one welcome panel for intentional webcam, LAN DVR and approved public webcam choices.](media/current/monitor-desktop.jpg)

*Actual tested UI, but no camera connected, recorded or analyzed. [Screenshot provenance](media/current/README.md).*

Monitor starts empty. There are no generated camera photographs, simulated
playback controls or new sample events. Existing reviewed sample records remain
readable as legacy samples without invented evidence.

The first-run camera wall has **one source-selection area** with distinct choices for a computer webcam, local DVR/IP camera and authorized public webcam. You can also use the persistent **Connect source** toolbar button. Empty slots no longer pretend to be cameras or repeat the same action. After connection, the wall shows only the actually selected source previews, not synthetic placeholders. Clicking a source category opens setup but does not request permission or connect by itself.

Connect a built-in/USB webcam or a configured RTSP channel explicitly. Previews
are video-only: preview alone does not record, run detection or track people.
Monitor now offers an explicit **Record webcam clip** action for the connected
browser webcam. It requests a stop at 60 seconds, keeps at most 64 MiB, and
passes only video tracks to the recorder. Leaving Monitor, hiding the page or
disconnecting stops capture. Save the clip or import it into the local analyzer;
the browser copy is lost on reload/close. These RTSP and public source connections remain previews. The separate
[one-camera LAN recorder](lan-recording.md) records only its explicitly configured
RTSP channel after Start in Recognition.
See [capture through reporting](recording-workflow.md). The separate
[Recognition workflow](local-analysis-service.md) analyzes selected recordings
with the existing analyzer and verified review-bundle contract.

## Webcam

Open the app on HTTPS or localhost. Select the **Computer webcam** welcome card or choose **Connect source → This computer’s webcam**, optionally refresh/select a device, then press **Connect webcam**.
Allow camera permission when the browser asks. No microphone is requested.
Disconnect closes the media tracks. Denied access, busy/missing devices and
permission revocation are visible; cancellation also stops a late permission
result. Camera names may be hidden until permission is granted.

## Local DVR or IP camera

This first connection path supports **RTSP over TCP**, with a fixed private IPv4
address. It does not scan the LAN or implement ONVIF discovery, DVR vendor APIs,
cloud-camera accounts, public endpoints, hostnames, IPv6, RTSPS or UDP transport.
Consult the DVR’s own setup page/manual for the RTSP channel path. Prefer a
read-only viewer account and a low-bandwidth substream at or below 1080p.

1. Install the repository’s Linux or Windows local edge environment; see
   [Linux](setup-linux.md) or [Windows](setup-windows.md).
2. Copy [the example](../edge/local-feeds.example.json) to `local-feeds.json` in
   the repository root. This local filename is ignored by Git. Replace the example
   address/path with your DVR’s exact settings. Add one entry per channel.
3. Restrict the file to your OS account (`chmod 600 local-feeds.json` on Linux).
   Credentials are local plaintext settings, not a credential vault. Do not commit,
   export to a hosted Site or upload it. On POSIX, the service and Check warn while
   group or other accounts can read the file.
4. Start the local app, then use **Set up local DVR → Load configured DVR sources**.
   Select a channel and press **Connect DVR channel**. Startup/loading choices does
   not connect cameras.

Linux:

```bash
DVR_FEEDS_CONFIG="$PWD/local-feeds.json" bash scripts/run-linux.sh --feeds
```

Windows PowerShell:

```powershell
.\scripts\Start-IntelligentDvr.ps1 -Feeds -FeedsConfig "$PWD\local-feeds.json"
```

Direct command after building (`npm run build`), using the installed edge Python:

```bash
python -m edge.local_service --feeds-config local-feeds.json --port 4173
```

Open `http://127.0.0.1:4173/` directly. Add `--recordings /your/folder --config
/your/analysis.json` to enable recording analysis in the same app. Launchers also
accept both modes/configurations together. The hosted Site can use browser
webcams but cannot bridge LAN DVR channels through this local service.

## Preview lifecycle and limits

| Boundary | Enforced behavior |
| --- | --- |
| Explicit start | No camera activation on page load, source enumeration or service start; no automatic reconnect |
| Connections | Up to four active DVR workers per local service; UI limits total webcam + DVR connections to four |
| Configured choices | Up to 100 named sources; only a selected source ID crosses the browser API. This is not 100 active-camera qualification |
| Source network | Exact owner-configured RFC1918 IPv4 and port. A local TCP relay pins upstream; RTSP redirects are refused before native decoding |
| Credentials | Private worker stdin, not argv, browser JSON/storage, temporary files or logs; dedicated video-only viewer account recommended |
| Decoder | OpenCV FFmpeg CPU, one decoder thread, RTSP/TCP + video only; 8-second open and 5-second read timeout |
| Resources | 2 GiB address-space/process-memory limit per worker on Linux/Windows; Linux also caps summed CPU time at 1,860 seconds (two threads for the full 15-minute session) and disables core dumps |
| Output | One latest JPEG, maximum 512 KiB, maximum 960 pixels on longest edge, at most 4 emitted frames/s. Full stream decoding is still required |
| Input | Reject decoded frames above 2,073,600 pixels; native allocations are additionally memory bounded |
| Lifetime | 12 seconds to first frame, 8 seconds without a new frame, 15-second client lease, 15-minute maximum preview |
| Browser | Sequential frame requests, one retained object URL per channel; hide or leave Monitor to disconnect; webcam tracks stop immediately |
| Failure | Drop last image and show an actionable error. No stale image is presented as a current feed. Explicit retry required |
| Failure cause | A worker exit stays `CONNECTION_FAILED`, plus a fixed `cause` from the worker's bounded failure file or a classified signal exit, such as `UPSTREAM_UNREACHABLE`, `RTSP_UNAUTHORIZED`, `RTSP_NOT_FOUND`, `REDIRECT_REFUSED`, `DIMENSIONS_UNSUPPORTED`, `HTTP_STATUS_4XX`, `CONTENT_TYPE_REFUSED`, `TLS_VERIFY_FAILED` or `CPU_LIMIT`. Known causes get a specific message. Causes never contain addresses, paths or credentials |
| Shutdown | Kill/reap workers and remove temporary frames. If the service dies, its private worker pipe closes and the worker exits on Linux and Windows; Linux also arms a parent-death kill. Abrupt death may leave temporary frames for OS cleanup |

RTSP without TLS sends media on the LAN and may use Basic authentication. Use a
trusted isolated LAN and a viewer-only account. The relay deliberately leaves
RTSP request URIs intact so authentication stays consistent; some DVR firmware
may require a particular URI host and must be qualified individually. Unsupported
redirects require configuring the canonical channel directly. Native codecs are
not a complete sandbox against a malicious device; keep the local runtime updated
and connect only owner-approved devices.

A hidden/suspended/crashed browser may not deliver a disconnect request. The
server lease ends that preview without a retry. Several tabs share the same
four-worker budget; a channel already open elsewhere reports “already has a
preview.” Browser-visible tile count is separate from connection count.

## Evidence and boundaries

The [qualification record](verification/local-feeds-2026-10-29/README.md) separates
synthetic transport/browser checks from physical-device acceptance. Tests use
Chromium’s generated webcam and a bounded local RTSP/JPEG fixture with an auth
challenge, actual TCP relay, OpenCV decoding and browser JPEG delivery. The
fixture is test-only; the production configuration rejects loopback endpoints.

No physical DVR or webcam was available to this execution session. Compatibility
with your particular DVR, H.264/H.265 channel settings, sustained latency, recording,
live inference, tracking and the 100-camera requirement still need device/hardware
qualification. No camera footage is uploaded for testing.

Primary API references: [browser media permission and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[OpenCV video capture timeout properties](https://docs.opencv.org/4.x/d4/d15/group__videoio__flags__base.html),
[FFmpeg RTSP handling](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/rtsp.c).
## Public internet webcams

The local service also supports owner-approved direct HTTPS JPEG/MJPEG webcams.
Use **Monitor → Public webcams** and the [public-webcam setup and safety guide](public-webcams.md).
Public sources share the four-preview cap and expiring leases. They disclose the
operator's public IP/request to their provider; local recordings and DVR footage
are not uploaded. No provider is enabled by default.

