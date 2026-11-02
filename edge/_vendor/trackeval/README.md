# TrackEval metric subset

Source: https://github.com/JonathonLuiten/TrackEval

Pinned commit: `12c8791b303e0a0b50f753af204249e622d0281a`.

Included: CLEAR, Identity, HOTA, their base class, timing helper and utilities.
The complete upstream [MIT license](LICENSE) is preserved. `upstream.json` records
the SHA-256 of each original source file and the locally adapted files. Empty
package initializers intentionally omit upstream dataset/evaluator imports.

Explicit changes:

1. Replace SciPy's assignment import with `assignment.py`, an adapter to the
   existing `edge.tracking.assign` Hungarian solver. All finite costs are feasible;
   deterministic input-order ties may differ from SciPy's equally optimal choices.
2. Replace removed `np.int`/`np.float` aliases with `np.int64`/`np.float64`.
3. CLEAR optionally calls an audit callback after matching/IDSW calculation. It
   exposes error locations without changing matching, accumulation or formulas.

No upstream dataset loader, external fetching, metric discovery or code download
is used. The workflow imports only these metric classes; plotting/report-writing
utilities in the preserved helper sources are not invoked. See the
[operator guide](../../../docs/tracking-evaluation.md) for conventions, limitations
and tests. This is an adapted source subset, not a claim of identical results for
every benchmark preprocessing policy or equal-cost tie.
