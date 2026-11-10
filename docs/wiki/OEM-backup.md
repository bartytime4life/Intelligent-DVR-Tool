# Keep your OEM DVR and add a local backup

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Recording review](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow) · [LAN recorder](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/LAN-recording)

Use **Recognition → Use my existing DVR** on the computer running Intelligent
DVR. Your existing OEM software keeps recording. This companion reads selected
finished files, makes separate byte-for-byte copies, verifies their SHA-256
fingerprints, and optionally analyzes eligible copies locally. It never changes
OEM recording settings, moves/deletes originals, or connects cameras on save.

This source implementation has controlled Linux software checks. Compatibility
with a particular OEM, physical camera, Windows/Mac host, codec or mounted share
must still be checked. It cannot promise compatibility with every DVR.

Before relying on a real OEM, complete the [one-recording field acceptance procedure](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/OEM-field-acceptance).

## Quick setup

1. Open **Start-DVR-Companion-Windows.cmd** or **Start-DVR-Companion-Linux.sh**
   with your already prepared local model (on Mac use the ordinary Start). Then open
   **Recognition → Use my existing DVR → Connect to this computer**. The ordinary Linux/Windows PC
   launcher exposes guided camera setup. A prepared Mac analysis launch exposes
   the folder backup; its LAN preview/recorder platform limits still apply.
2. Choose the **DVR source folder** where the OEM finishes recordings or exports.
   Use **Choose source folder**, or paste the full path from your file manager.
   If the native chooser is unavailable, path entry still works. Subfolders are
   included by default. An OS-mounted LAN recording share can be a source; its
   connection and access permissions remain managed by the operating system.
3. Choose a **Separate backup folder** on storage attached to this computer.
   Neither selected folder may contain the other. A separate physical drive
   protects against more failures than two folders on the same drive.
4. Review **Storage & file settings**. Defaults: 100 GiB library budget, 2 GiB
   free-space reserve, and 60 seconds of unchanged size/timestamps across repeated
   scans. Choose **Save settings**. No copying has started yet.
5. Optionally check **Analyze copied videos automatically**, choose the prepared
   model and compatible rules, then choose **Start backup**. Without that checkbox,
   the tool copies files without claiming the analyzer. Analysis prefers the GPU, with a visible CPU fallback, and processes one
   copied video at a time and waits while another job owns the analyzer.
6. Open **Saved videos → Review backup** to inspect a completed source-matched
   result. Legacy completion labels explicitly leave recording coverage unverified;
   only structured coverage metadata describes why analysis stopped. Events still require
   an explicit human handoff from the existing Recognition review.
7. **Stop backup** pauses copying and cancels its active analysis. Completed copies
   remain. Closing a browser tab does not stop the service; restarting the service
   always leaves backup paused. Settings and completed reviews survive restart.

Opening **Review backup** verifies the result and exact saved recording. One
opening runs at a time with a two-minute deadline. **Cancel backup opening**
releases its controls and preserves the current review. While connected with
backup or analysis active, **Stop backup** remains available during opening.
Cancelling an opening does not stop background backup or delete a saved video.

To expose camera setup with a direct developer invocation, use matching
`--feeds-config` and `--camera-setup-config` paths. File backup is available when
`--recordings` and `--config` are supplied together. No extra server, subscription,
cloud account or model download is introduced.

## Choose the appropriate connection

| Existing system | Practical path | What needs checking |
| --- | --- | --- |
| OEM saves MP4, MOV, M4V, AVI, MKV or WebM | Watch the finished-recording folder; analyze verified copies | Actual container, codec, permissions and recording-close behavior |
| OEM uses BVR, DAV, raw H.264/H.265 or another listed legacy format | Keep a backup copy; use the OEM's standard-video export for analysis | Export availability, timestamps, audio and codec |
| IP camera or DVR/NVR exposes authorized RTSP channels | Add a channel in the guided form below; explicitly connect in Monitor | Device's documented private IPv4 address, channel path and viewer credentials |
| DVR offers only a vendor cloud or closed SDK | Use an authorized local standard-video export if available | A vendor-specific adapter is still needed; none is implied |
| ONVIF-capable camera/DVR | Use its documented RTSP channel or standard exports | ONVIF discovery and Profile G retrieval are not implemented |

For example, [Blue Iris's official manual](https://blueirissoftware.com/blueiris.pdf)
documents exports from BVR to MP4. [Synology's recording settings](https://kb.synology.com/en-us/SurveillanceStation/help/SurveillanceStation/recording_advanced?version=9)
document AVI/MP4 file format choices. These are documented integration paths, not
proof that those products have been physically tested with this tool.
[ONVIF profiles](https://www.onvif.org/profiles/) describe distinct device/client
capabilities; an ONVIF label alone is insufficient evidence of interoperability.

## Add an IP camera or local-network DVR

Expand **Connect an IP camera or LAN DVR**. Enter a name, its exact private IPv4
address, RTSP port, the documented channel path and a viewer login. **Save camera
source** stores the credentials privately in the local service configuration; the
response contains only source IDs and names. Passwords are cleared from the form
and never placed in browser storage or URLs. Existing manual/public sources are
preserved. Use **Monitor** to explicitly connect the saved channel.

To use the existing one-camera recorder, select the saved channel and choose
**Use for LAN recording**. The app opens the **Record a LAN camera** task and
moves keyboard focus there. Review its settings, then explicitly choose
**Start recording & analysis**. Saving/configuring alone never connects it. This
removes JSON editing for the ordinary Linux/Windows setup path. The recorder
remains a bounded, sampled video-only pilot with possible gaps and automatic
retention. It is separate from the full-byte OEM backup library and is not an
archival substitute. See [LAN recording limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/LAN-recording).

GPU preference and CPU overrides follow the [local GPU guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-GPU).

## Storage, integrity and recovery

If contact with the service is lost, **Status unknown** labels the last checked
storage and saved-video details. Copy progress stops displaying as current until
you refresh the connection; background backup may still be running. Switching
Recognition tasks retains pending folder edits and shows backup activity or an
attention notice on its task button.

Status announcements describe changes in backup/analysis state and connection
availability. Storage totals and sample counts still update on screen without
being announced on every poll.

During index recovery, malformed receipts and unexpected entries are left
untouched while valid saved copies remain available. A persistent recovery
warning reports that recovery skipped entries; saving settings or restarting backup does
not clear it. Inspect and preserve those files before any manual repair.

Copies live under `BACKUP_FOLDER/Intelligent-DVR-Backup/`. Each saved video has
its own directory containing `source.EXT` and a private `receipt.json`; completed
analysis adds `review.json`. `library.sqlite3` is the durable index. Local settings
live in `.backup-library/` beside the configured analysis catalog. Keep the whole
backup tree, including SQLite files, together; stop the service before making a
filesystem-level backup of the index. Models, enrollment templates, plans and
browser review decisions need their existing separate backups.

The tool checks source identity before/after bounded copying, syncs the finished
file, re-reads its bytes for hash verification, and only then commits the index.
Unchanged source versions are skipped; identical bytes in the same container
reuse a hash-verified saved copy. Changed versions get new copies. A source can
be deleted or disconnected after copying without invalidating its saved review.
Copy/analysis interruptions are visible, and a complete hash-verified file receipt
can rebuild an index row after a publication/commit interruption. Unknown or
unfinished artifacts are preserved for inspection, never pruned silently.

No automatic deletion occurs in this library. Copying waits when its budget or
free-space reserve is reached. Free space or choose another backup folder; the
tool does not delete saved evidence to make room. Disk/OS failures can still
interrupt work; fsync/SQLite tests do not establish power-loss durability.

Supported backup extensions: `.mp4`, `.m4v`, `.mov`, `.avi`, `.mkv`, `.webm`,
`.bvr`, `.dav`, `.264`, `.265`, `.h264`, `.h265`, `.ts`, `.ps`, `.mpg`, `.mpeg`,
`.wmv`, `.asf`. Other extensions are ignored; there is no universal binary-file
or proprietary-container decoder. Empty files are skipped. Files above 64 GiB
are not copied and are reported. Analysis is limited to the first six container
extensions above, 512 MiB per file, 6,000 decoded frames and the existing five-
minute worker budget; eligible files can still fail codec/coverage validation.
Large copies and original audio remain byte-identical; analysis does not add
speech or audio analysis. The library holds at most 10,000 unique recordings and
50,000 source-version entries. The UI lists the latest 100 recordings.

Source scanning is bounded to 10,000 entries and 16 subfolder levels per pass.
When a limit or permission barrier is hit, status says the scan is incomplete;
select a narrower source folder. Symlinks and special files are skipped. The
quiet-time check is a heuristic: an OEM can pause and resume writing later.
Prefer completed exports/closed-file folders and verify one real clip before
relying on unattended backup. Continuous recording, camera timestamps, all-file
coverage, novice usability and 100-camera capacity remain unqualified.

## Read saved byte-check receipts

In the same Recognition backup task, open **Check backup receipts**. Load the
verifier's current JSON receipt and optionally its earlier receipt. This browser-
local view needs no model, recording or service connection. It keeps byte
correspondence, reported review/coverage/backend and field acceptance separate;
see the [acceptance procedure](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/OEM-field-acceptance#read-byte-check-receipts-in-the-app).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/oem-backup.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
