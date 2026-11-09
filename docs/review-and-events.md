# Review observations and export decisions

[Visual handbook](how-to.md#4-review-and-export) · [Recording workflow](recording-workflow.md) · [Recognition contracts](recording-recognition.md)

![A deliberately selected clip is analyzed, then a person reviews observations and exports the result.](media/guide/recording.svg)

![Actual Events filters with one observation from the generated example recording.](media/guide/events.jpg)

*The example observation is produced by a constant-output test model; it is not a real incident.*

## Before you make a decision

Open results with their exact original recording. Recognition verifies the source
bytes before attaching overlays. Read complete/partial coverage and the sampled
frame position. A box or score is an observation to investigate, not a verdict.

## Work through the queue

1. Inspect the relevant sampled scene in **Recognition**. Compare the box with
   the original image and the configured class, region, threshold and dwell rule.
2. Use **Send observations to Events** deliberately. A LAN segment also requires
   its own explicit send action; it is not queued automatically. A
   [live AI](live-detection.md) observation is sent one at a time from its Monitor
   tile, with the analyzed still; there is no recording behind it, so Events labels
   it **Live AI** and shows no Open in Recognition button.
3. In **Events**, use filters to focus the queue, open an observation, make the
   appropriate confirm/dismiss decision and add a note explaining the evidence.
4. Use **Undo** when correcting a decision. The review state stays through
   workspace changes; storage errors are visible and need attention.
5. Return to Recognition for a report with the current decisions matched to this
   source. Save the recognition results and analyzed recording as a pair.

Keyboard review, local observation stills, CSV and bulk dismiss are convenience
controls. Verify the selection and original evidence before a bulk decision.
Possible enrolled-person suggestions have a separate Confirm/Not this person
flow; they do not reach Events or exports automatically.

State announcements describe changes such as analysis starting, finishing or
losing contact with the service. Frequently refreshed sample, storage and queue
counts remain readable in place without being announced on every poll.

![Actual review dialog with the generated still, source fingerprints, a note field and human decision controls.](media/guide/review-dialog.jpg)

## Choose the right export

| Export | Keep it for |
| --- | --- |
| Printable HTML report | An offline readout; print to PDF when needed |
| Report JSON | Structured report with the current supported review decisions |
| Observation CSV | A compact tabular readout of observations |
| Recognition results + analyzed recording | Reopening the exact source/result pair |
| Browser review/rule backups | Preserving browser state before an origin change or reset |

Browser storage can be edited or cleared; it is not a shared, authenticated audit
trail. Counts across sampled frames can include repeated sightings of the same
person. Preserve the original recording and context when sharing a report.

## Resolve a browser save conflict

Reviews and browser rules are saved separately. If another tab changes a workspace
while this tab has unsaved edits, the app keeps this tab's version in memory and
pauses saving. This includes edits left unsaved by a quota or permission failure.
Further edits do not silently replace the other tab's saved version. A tab with
no unsaved edits can adopt a valid save from another tab.

1. In **Reviews save conflict** or **Rules save conflict**, choose **Download this
   version** and **Download other version**. Inspect both files before deciding.
   An unreadable other version is offered as raw text so it can be preserved.
2. Choose **Keep this tab’s version** to save the in-memory version, or **Use other
   tab’s version** to adopt the saved one. The displaced version must be backed up
   in this browser first. An unreadable version cannot be adopted. If another tab
   removed the saved entry, the choice explicitly offers an empty review queue or
   default browser rules.
3. If either version changed while the choice was waiting, review the refreshed
   versions and choose again. A storage error leaves both versions available for
   download and keeps saving paused. Reloading or closing can discard the version
   held only in memory; heed the unfinished-work warning.

Each workspace has room for **ten saved conflict copies**. Existing copies are
never replaced automatically. In **Saved conflict copies**, use **Download copy**,
inspect the downloaded file, then explicitly choose **Remove this copy** only when
you no longer need its browser copy. Removal is enabled after that exact copy's
download starts, and removes only the rechecked copy. It does not clear the current
queue, current rules, source recordings or OEM backups. If all ten slots are
occupied, make room this way before retrying the unresolved choice. Downloads
remain separate from browser storage and do not remove a copy by themselves.
Saved-copy downloads preserve the stored backup archive, including its raw
snapshot; damaged copies retain their original bytes. These archives are for
inspection and recovery, and are not accepted directly by **Import reviews**.
Use **Download this version** or **Download other version** for the ordinary
portable review export.

Browser saves and conflict choices use a shared browser save lock. If this feature
is unavailable, the app reports that changes are in memory and keeps export
available. Preserve downloads before changing browser or origin. Unreadable
startup data keeps its separate recovery download; do not clear storage to force
a save.
