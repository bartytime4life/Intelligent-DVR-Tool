# Review observations and export decisions

[Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook#4-review-and-export) · [Recording workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow) · [Recognition contracts](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details)

![A deliberately selected clip is analyzed, then a person reviews observations and exports the result.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recording.svg)

![Actual Events filters with one observation from the generated example recording.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/events.jpg)

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
   [live AI](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-AI-and-tracking) observation is sent one at a time from its Monitor
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

![Actual review dialog with the generated still, source fingerprints, a note field and human decision controls.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/review-dialog.jpg)

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

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/review-and-events.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
