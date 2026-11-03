# Guided training

Use **Train → Start session** to check how often the detector spots a person in your camera’s view. You can try a different detection threshold, then compare the two settings on a second recording before choosing which to use in Recognition. A lower threshold accepts weaker detections. A higher threshold requires stronger evidence of a person.

## Start

Use one webcam and one person who agrees to take part. Set the camera where it will be used and keep its position and lighting consistent across both recordings. The prepared local analysis setup includes a whole-frame person rule suitable for this session.

Once the detector and recording inbox are prepared, open training from the installed folder. The Linux and Windows training launchers open **Train** with local analysis, recording import and rule saving enabled. You choose when to connect the webcam and start recording.

| Platform | Launch with training enabled |
| --- | --- |
| macOS | Double-click `Start-Mac.command` in the configured checkout. [Mac setup](setup-macos.md) |
| Linux | Run `bash Start-Training-Linux.sh`. [Prepare recording recognition](pc-testing.md#prepare-recording-recognition) |
| Windows | Double-click `Start-Training-Windows.cmd`. [Prepare recording recognition](pc-testing.md#prepare-recording-recognition) |

For a custom catalog or port, pass those options to `bash scripts/run-linux.sh --train` or `.\scripts\Start-IntelligentDvr.ps1 -Train`. If the app reports missing setup, follow the preparation instructions above, then reopen Train.

## Make the first recording

1. Select **Start session**. At **Camera check**, open **Detector and reference rule** if you want to choose the local detector and the rule used for the Current column. Select **Connect camera**, grant camera permission, and check the framing and lighting. The microphone stays off.
2. Start the guided recording. The five prompts take **54 seconds**. Stay in view for 10 seconds, leave for 12, walk along the far side for 14, stand partly hidden for 10, then return for 8. If you want an audible cue while out of view, enable **Play prompt tones** before recording. One tone marks a prompt and two mark the finish. The tones play locally. Keep the training tab visible to follow the script. If the tab becomes hidden, capture pauses and gives you a countdown when you return.
3. Let local analysis finish. Compare **Current** and **Trial**. For each threshold, the scorecard gives the number of person detections during the in-view prompts and the number of person flags during the empty-room prompt. Each count includes the number of frames checked.
4. Open **Review the first recording** to inspect individual prompts and available stills. Under **Advanced sensitivity**, move the slider from 0.30 to 0.90 in steps of 0.05 to preview how another threshold would score on the same frames. You can choose **Keep current setting** and record the calibration in your history.

The app tests suggested thresholds from **0.40 through 0.90** in steps of 0.05. It considers a change only when it still finds someone during the in-view prompts, improves one count and holds or improves the other. It gives the in-view and empty-room conditions equal weight when ranking those choices. Ties favor a setting close to a safety margin above the strongest empty-room score. The fresh recording tests whichever threshold you chose.

## Check the setting on new footage

Select **Check on a new recording** to fix the trial threshold before recording. With the same camera and view, walk through the frame for **10 seconds**, then leave the frame empty for **10 seconds**. The app scores the current and trial settings on the same new samples, using the same detector and rule configuration as the first recording.

Confirm that the person was actually in view and the room was actually empty at the prompted times. If someone else walked into view or you missed a prompt, repeat the check. The prompt timings tell the app what you expected and your confirmation establishes the conditions for this comparison.

Read the two rows together. More in-view finds are better. Fewer empty-room flags are better. Each sample is one frame, so two flagged frames can come from the same object.

![Training scorecard on synthetic inputs. At thresholds 0.70 and 0.40 the test model reports 0 of 32 and 32 of 32 during the in-view prompt. Both settings flag 0 of 25 empty-prompt frames.](media/training-2026-11-02/scorecard.png)

**Synthetic browser example.** A test model responds to changes in the brightness of generated pixels. On the same fresh recording, lowering the threshold from 0.70 to 0.40 changed its in-view count from 0/32 to 32/32. Both settings flagged 0/25 empty-prompt frames. This exercises the comparison, confirmation and save workflow. [Download the example JSON receipt](verification/training-studio-2026-11-02/synthetic-comparison.json)

A separate run exercised the pinned YOLOX-S detector and recording timestamps on generated video. Physical-camera accuracy needs independently labeled, representative recordings. [Pinned detector runtime record](verification/training-studio-2026-11-02/pinned-detector-smoke.json) · [Offline evaluation](offline-evaluation.md)

## Choose the result

| Fresh check result | What to do |
| --- | --- |
| Trial improves one count and holds or improves the other | Choose **Use checked setting** if the difference helps your work. You can also keep the current setting. |
| Both settings give the same counts, or the current setting does better | Choose **Keep current setting**. The comparison is still useful as a baseline. |
| More finds come with more empty-room flags, or fewer flags come with fewer finds | Review the tradeoff. Try another calibration if the missed views or empty-room flags matter for this camera. |
| Fewer than three scored samples in either condition | Repeat the check. Both conditions need at least three samples for a verdict. |

Applying requires a confirmed improvement at a different threshold, reliable timing on both recordings, permission to save training rules, and a rule set containing a single whole-frame person rule. A set with one person rule plus other rules, or one person rule limited to a zone, can be measured as a whole-view comparison. To apply a threshold, start a new session with a single whole-frame person rule. If your active set has zero or multiple person rules, choose a set with one person threshold before training. A change to the trial threshold needs a new check.

## Build on multiple sessions

At Camera check, give the **Camera view name** a useful name such as “Front door.”
Reuse it for later sessions with the same camera position and view. Use a new name
after moving the camera. At the scorecard, select **Add this session to the
combined evidence** only after confirming you followed all five prompts.
Choose Keep current setting or Use checked setting to save that session's evidence.
Incomplete sessions and unconfirmed prompt conditions do not join the collection.

![Actual browser test showing two confirmed sessions retained after a reload. All inputs and displayed sessions are synthetic test data.](media/training-2026-11-02/cumulative-sessions.png)

**Generated test example:** two sessions remain saved for one named camera view
after reopening Train. The constant-output fixture detector is a workflow test,
not a camera accuracy result. [Screenshot provenance](media/training-2026-11-02/cumulative-manifest.json).

The next session can use all matching confirmed calibration recordings together.
Matching requires the same named view, camera identifier (when available), detector
and class-label fingerprints, inference profile, dwell and maximum gap. A newly
saved threshold may have a different rule name/hash and can still build on the old
evidence. Other camera views, changed models and specialized zone rules stay separate.
When the browser cannot supply a camera identifier, your named-view confirmation is
the camera reference; take care to use the same physical camera and position.

In browsers that provide Web Locks, saving a decision holds a shared browser
lock through the service checks and rule save, so another training tab cannot
add a contrary example between replay and application. Without that browser
feature, use one training tab at a time.

Each calibration session has equal weight when ranking threshold suggestions,
with the in-view and empty-view conditions weighted equally. A proposal must avoid
losing any person finds or adding empty-room flags on every calibration recording.
Saved fresh checks do not fit the suggestion: they are replayed to look for
regressions. The scorecard shows combined counts alongside the latest recording's
counts. Even after several sessions, applying still requires an improved,
operator-confirmed fresh check, and neither count may worsen on any saved
calibration or check recording. Reusing identical recording bytes cannot inflate
the session count or supply another fresh check.

**Combined training evidence** on Train shows saved sessions and lets you remove
an old session from future comparisons. Removing evidence leaves recordings,
saved rules and review decisions available. The library retains up to 50 sessions
and two million serialized characters in this browser; it refuses additions at
the limit rather than automatically dropping earlier evidence. Storage failures
are shown explicitly. Reloading or returning to Train retains saved evidence;
clearing browser storage or changing browser/origin loses it. Historical summary-only
sessions lack the scores and provenance needed for pooling and remain in Past sessions.

More confirmed sessions provide more examples to test a rule, but they cannot
guarantee higher accuracy. This workflow tunes a person-presence threshold; it
does not retrain neural-network weights. Counts on guided prompts are session
measurements, not independently established detection accuracy. Face baseline
refinement remains the separate consent-based person workflow.

[Cumulative-session verification and machine-readable results](verification/cumulative-training-2026-11-02/README.md)
describe generated test inputs separately from physical-camera qualification.

## What is saved where

| Item | Where to find it |
| --- | --- |
| First and check recordings | Imported into the configured local recordings folder. Keep or remove them under your local retention policy. |
| Checked setting | When you apply, the local service saves a rule file under `trained/` beside its catalog. Existing rule files remain available. The service allows up to 50 saved training rule sets. |
| Recognition selection | This browser remembers the checked detector and saved rule together for future recording analyses. New selections include fingerprints for the model, class labels and rule file, plus the inference profile. A changed component requires an explicit choice or a fresh check. Recognition respects a manual selection you have already made. If the rule saved but the browser could not remember the preference, select that detector and rule by name in Recognition. |
| Session history | This browser keeps the latest 50 entries. Past sessions distinguish a first-recording result from a comparison confirmed on a second recording. |
| Combined training evidence | This browser keeps up to 50 explicitly confirmed sessions, including their scored person/empty samples, detector provenance and local camera reference. It does not automatically evict older evidence. Save a decision to add a session; simply exiting does not add it. |
| Downloadable JSON receipt | Export the session’s counts, thresholds and fresh-check result, when available, as JSON. Combined evidence adds aggregate counts and prior recording fingerprints; this summary cannot restore the scored library. SHA-256 fingerprints identify the source recordings, detector, labels and rules. The file omits video, device IDs and names. |

Training adjusts the threshold used by a recognition rule. Only new recording analyses using the selected rule use its threshold. Previously reviewed observations retain their decisions. For a consenting individual’s face baseline, choose **Enroll a person** and follow its separate consent and deletion controls. [Person enrollment](person-enrollment.md)

## How frames are counted

The local decoder (PyAV) reads the presentation time of each sampled frame. Its decoded video duration must agree with the active recording clock within half a second. This check runs on both recordings and excludes paused time. If a complete calibration clip lacks reliable timing, you can still review estimated counts based on frame position. Record again before applying a setting. A partial clip or analysis that covered only the beginning of a recording cannot supply a training result.

The scorecard skips the first two seconds after a prompt change to give you time to respond. A frame counts as a find or flag when its strongest person score meets the threshold. Both settings are fixed before the fresh recording starts.

For installation or service problems, see [local analysis setup](local-analysis-service.md) and [troubleshooting](troubleshooting.md).
