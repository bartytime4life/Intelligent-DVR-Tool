# Approved public internet webcams

Monitor supports explicitly connected, owner-approved **direct HTTPS JPEG
snapshots** and **length-delimited MJPEG streams**. This is a local preview
adapter, not a directory of exposed devices. Start with a provider-published
weather, park or public-scene webcam whose terms permit your intended viewing.
An accessible camera is not evidence of permission to reuse it.

## Configure and connect

1. Find the provider's official webcam page and read its terms. Obtain its
   documented direct JPEG or MJPEG endpoint. A normal webpage, YouTube player,
   iframe, HLS `.m3u8` playlist or login page will not work through this adapter.
2. Use [the configuration example](../edge/public-webcams.example.json) as the
   shape. Its `.invalid` hostname is deliberately rejected until replaced; it
   never points at an actual camera. Merge the entry into the `sources` array
   in your existing `local-feeds.json`, preserving existing DVR entries.
3. Enter a lowercase DNS `host` and the exact `/path` separately. The protocol
   is fixed to HTTPS and the port to 443. No username/password, authorization
   header, browser cookies, arbitrary port, IP literal or redirect is supported.
   Do not place secret tokens in query strings. Set provider attribution and
   an HTTPS `provider_url` for the official viewing/permission page.
4. Set `permission` to `public-viewing` only after confirming the intended use.
   This is your declaration, not automatic license verification. Choose
   `public-jpeg` and `refresh_seconds` of 30–3600 seconds, respecting the provider's
   published cadence. For `public-mjpeg`, omit `refresh_seconds`; parts must
   declare `Content-Type: image/jpeg` and a bounded `Content-Length`.
5. Restart the local app, keeping your chosen port, for example
   `bash scripts/run-linux.sh --port 4187`. Run Check with the same port first.
   Check validates syntax offline; DNS, TLS, permissions and provider availability
   are only tested when you explicitly connect.
6. **Monitor → Public webcams → Load approved public webcams → select source →
   Connect public webcam.** Loading the catalog makes no provider request.
   The selected provider is contacted only after Connect.

The [National Park Service's official directory](https://www.nps.gov/nature/webcams.htm)
is one place to inspect intentionally published cameras. Its
[Yellowstone explanation](https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm)
distinguishes periodically refreshed images from streaming video. A directory
listing is not a direct endpoint, permission grant, uptime guarantee or claim
that this adapter supports every listed player. No public source is installed
or activated by default.

## Privacy, safety and resource limits

Connecting discloses your computer's public network address, the selected request
path, DNS lookup and a generic application user agent to network/provider
infrastructure. It does not upload local webcam frames, DVR credentials, facility
plans, recordings, models or recognition results. TLS uses the system CA trust
store with certificate/hostname verification. This direct HTTPS adapter does not
use environment-configured HTTP proxies; managed networks may block it.

The service accepts only source IDs from the browser. DNS runs inside the bounded
preview worker. Every returned IP must be global/public; loopback, LAN, link-local,
metadata, multicast, reserved and mixed public/private answers are refused. A
validated IPv4 is pinned for the connection while the original hostname is kept
for TLS verification and Host. Each snapshot connection resolves and validates
again. IPv6-only providers are unsupported. Redirects are never followed; no
cookies, referrer, authentication, page scripts or provider HTML are executed.
These choices follow the [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

Incoming JPEGs are capped at 2 MiB and 1080p pixel count; dimensions are inspected
before bounded native decoding. Native image limits, a 2 GiB worker memory bound,
one decoder thread, fixed network deadlines, at most four network previews,
one retained image and at most four MJPEG frames/second limit resource use.
They do not establish a complete malicious-media sandbox or provider integrity.
MJPEG transport backpressure can add latency; this is a preview, not synchronized
real-time monitoring.

The existing 15-second browser lease and 15-minute session bound apply. Disconnect,
hidden pages and leaving Monitor stop previews. Stopping public-only previews
does not create a local-webcam source or request webcam permission. Failures remove old images and
require explicit reconnect. Snapshot staleness uses the configured refresh
interval plus a 12-second retrieval allowance. The displayed age is **time since
retrieval**, not proof of provider capture time: a cached/frozen provider image
may still be returned successfully. No automatic outage recovery or fallback
provider is selected. Frames are temporary and deleted when previews stop;
this path does not save recordings or run recognition.

## Recovery and qualification

For a failed preview, check the official page first, direct endpoint format,
provider viewing permission, IPv4 DNS, TLS certificate, image resolution and
response size. HTTP-only feeds, redirects, authentication and unsupported player
formats are refused deliberately; use an official supported endpoint or view
the provider page separately. Keep software updated before viewing untrusted media.

Unit/native checks cover configuration, destination restrictions, connection
pinning, response rejection, JPEG/MJPEG bounds, native image publication,
cancellation/staleness and explicit recovery. Browser regressions use synthetic
API/image fixtures for selection, disclosure, attribution, mobile layout,
disconnect and error recovery. These checks do not qualify an external provider's
uptime, capture freshness, physical camera compatibility, unattended operation,
recognition accuracy, person tracking or 100-camera capacity.
