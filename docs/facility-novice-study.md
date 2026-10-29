# Facility novice acceptance study

Status: **unmeasured**. No recruited participants, field measurements or completed
sessions are represented by this kit. The original proposal compares:

| Flow | Availability |
| --- | --- |
| A — area selection + open footprints | Implemented; test public/local and offline recovery separately |
| B — area selection + imagery-assisted outlines | Unavailable; requires a licensed source/adapter and separate qualification |
| C — manual tracing or private file import | Manual building/shape drawing and facility/OSM JSON only; no generic CAD/BIM/GeoJSON adapter |

Recruit 5–8 novice facility staff with consent, using anonymous IDs P1–P8. Use the
same source revision and an approved, simple-site reference independently checked
by the observer. Prepare matched sites to reduce learning effects. Counterbalance
A/B/C order: P1 A-B-C, P2 B-C-A, P3 C-A-B, then repeat. Do not run unavailable B or
claim that replacing it with address/GPS/offline modes completes this comparison.

Task: find the site, confirm an area, review/correct exterior shells, identify which
heights/floors are estimates, apply, add one camera and export. Start timing when
the task is presented; stop at correct export or abandonment (cap 30 minutes).
Include retrieval, correction and recovery time. Record every attempted session,
including failures and assistance. An observer independently checks the exported
geometry against the approved reference; automated apply alone is not completion.
Record correction count and missing/wrong-shell notes separately on the private
observer sheet. Avoid facility-sensitive addresses, photos or participant names in
shared summaries. Field accuracy and real-device GPS tests need separate records.

Generate an empty record locally:

```bash
node scripts/facility-study.mjs template > qa-local/facility-study.json
node scripts/facility-study.mjs summarize qa-local/facility-study.json
```

The summary exits **3** while the comparison is incomplete, **2** for invalid
records, and **0** only for a complete recorded comparison requiring human review.
A zero exit is not automatic usability approval. Supply a 40-character source
commit, anonymous `observer_id` and private `site_reference`. Each session uses:

```json
{"participant_id":"P1","flow":"open-footprints","completed":false,"unaided":false,"geometry_reviewed":false,"estimated_heights_identified":false,"seconds":180,"corrections":0}
```

This line is a schema example, not an observation. `flows[].available` must reflect
the actual tested implementation. Reject duplicate participant/flow rows and
unavailable-flow sessions. The same 5–8 participants must attempt each available
flow; incomplete cohorts cannot produce a completed comparison. Unaided completion
requires completion, no assistance and observer geometry approval. Failures/aided
attempts stay in the denominator and in median attempt duration. Proposed gates:
80% unaided completion, median under 180 seconds, every participant recognizes
estimated heights. Summaries label observer-entered evidence as unauthenticated.

After actual observations, inspect failures/correction burden, choose improvements,
then retest before declaring a default validated. Until B is available and the
comparison plus real-site/device work is measured, issue #6 remains open.
