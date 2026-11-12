#!/usr/bin/env python3
"""Generated before/after calibration proof; no images, inference or dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
BASELINE = "66e6dd1cde9913e6c4f03fb94733e83dc3070c93"
SOURCE = "src/facility-calibration.mjs"
PROTECTED = [
    "edge/inference.py", "edge/journal.py", "edge/supervision.py",
    "edge/scheduler.py", "edge/profiling.py", ".openai/hosting.json",
    "worker/index.js", "scripts/prepare-sites-build.mjs", "tests/sites-worker.test.mjs",
]

NODE = r"""
const modules=await Promise.all(process.argv.slice(1).map(path=>import(path)));
const square=[[.2,.2],[.8,.2],[.8,.8],[.2,.8],[.5,.5]];
const refs=(points,map,fitCount=4)=>points.map(([x,y],i)=>({
  role:i<fitCount?'fit':'check',image:{x,y},ground:{x:map(x,y)[0],y:map(x,y)[1]}
}));
const zero=offset=>refs(square,(x,y)=>[1/(x+offset),y/(x+offset)]);
const line=refs([[.1,.1],[.9,.15],[.8,.9],[.2,.8],[.4,.3],[.5,.5]],
  (x,y)=>[x,2*x],5);
const noisy=[];
for(const x of [.2,.4,.6,.8])for(const y of [.2,.4,.6,.8]){
  const t=(y-.5)*10;
  noisy.push({role:'fit',image:{x,y},ground:{x,y:2*x+.001*t*(t*t-8.2)}});
}
noisy.push({role:'check',image:{x:.5,y:.5},ground:{x:.5,y:1}});
const horizon=refs([[.1,.1],[.9,.1],[.9,.9],[.1,.9],[.3,.3]],
  (x,y)=>[x/(x-.4),y/(x-.4)]);
function solve(module,input,from=[.25,.5],to=[.5,.5]) {
  try {
    const fit=module.fitPlanarCalibration(input);
    const ruler=module.calibratedGroundDistance(fit,from,to);
    return {accepted:true,method:fit.method,fitMax:fit.fit.max,
      checkMax:fit.holdout?.max??null,checkInsideHull:fit.checkInsideHull,
      eligibleAfterOperatorDeclaration:!!fit.holdout&&fit.checkInsideHull&&fit.fit.max<=.5&&fit.holdout.max<=.5,
      matrixMax:Math.max(...fit.matrix.map(Math.abs)),
      matrixNorm:Math.hypot(...fit.matrix),
      rulerMetres:ruler?.metres??null};
  } catch(error) {return {accepted:false,reason:error.message};}
}
const results=modules.map(module=>({
  safeZeroOrigin:solve(module,zero(0)),
  safeAlmostZeroOrigin:solve(module,zero(1e-14)),
  nearZeroOrigin:solve(module,zero(1e-10)),
  collapsedGroundPlane:solve(module,line,[.5,.3],[.5,.7]),
  noisyRankCollapse:solve(module,noisy,[.5,.3],[.5,.7]),
  horizonInsideHull:solve(module,horizon),
  scalarEquivalence:[1,1e-200,-1e-200,1e200,-1e200].map(scale=>({
    scale,point:module.projectGround([0,0,1,0,1,0,1,0,0].map(v=>v*scale),[.5,.5])
  }))
}));
process.stdout.write(JSON.stringify({fixtures:{square,line,noisy,horizon},baseline:results[0],candidate:results[1]}));
"""


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def git_bytes(path):
    return subprocess.check_output(["git", "show", f"{BASELINE}:{path}"], cwd=ROOT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New JSON output; never overwrites")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output must be a new file")
    baseline = git_bytes(SOURCE)
    candidate = (ROOT / SOURCE).read_bytes()
    preserved = {}
    for name in PROTECTED:
        raw = (ROOT / name).read_bytes()
        assert raw == git_bytes(name), name
        preserved[name] = digest(raw)
    with tempfile.TemporaryDirectory(prefix="dvr-projective-proof-") as temp:
        path = Path(temp) / "baseline.mjs"
        path.write_bytes(baseline)
        run = subprocess.run(["node", "--input-type=module", "--eval", NODE,
                              path.as_uri(), (ROOT / SOURCE).as_uri()],
                             cwd=ROOT, text=True, capture_output=True, check=True)
        proof = json.loads(run.stdout)
    old, new = proof["baseline"], proof["candidate"]
    for key in ("safeZeroOrigin", "safeAlmostZeroOrigin"):
        assert not old[key]["accepted"]
        assert new[key]["accepted"] and new[key]["eligibleAfterOperatorDeclaration"]
        assert abs(new[key]["rulerMetres"] - 5 ** .5) < 1e-10
    assert old["collapsedGroundPlane"]["eligibleAfterOperatorDeclaration"]
    assert old["collapsedGroundPlane"]["rulerMetres"] < 1e-10
    assert not new["collapsedGroundPlane"]["accepted"]
    assert old["noisyRankCollapse"]["eligibleAfterOperatorDeclaration"]
    assert old["noisyRankCollapse"]["rulerMetres"] < 1e-10
    assert not new["noisyRankCollapse"]["accepted"]
    assert not old["horizonInsideHull"]["accepted"]
    assert not new["horizonInsideHull"]["accepted"]
    assert old["nearZeroOrigin"]["matrixMax"] > 1e9
    assert new["nearZeroOrigin"]["matrixMax"] <= 1
    assert abs(new["nearZeroOrigin"]["matrixNorm"] - 1) < 1e-14
    assert old["scalarEquivalence"][1]["point"] is None
    assert old["scalarEquivalence"][2]["point"] is None
    for case in new["scalarEquivalence"]:
        assert case["point"] is not None
        assert max(abs(a-b) for a,b in zip(case["point"], [2,1])) < 1e-12
    record = {
        "baseline_revision": BASELINE,
        "source_path": SOURCE,
        "baseline_sha256": digest(baseline),
        "candidate_sha256": digest(candidate),
        "protected_sha256": preserved,
        "node_version": subprocess.check_output(["node", "--version"], text=True).strip(),
        "scope": "Generated numeric references only; no images, survey markers, cameras, inference or field accuracy.",
        "expected_safe_distance": "sqrt(5) metres from ground endpoints (4,2) and (2,1)",
        **proof,
    }
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(record, output, indent=2, allow_nan=False)
        output.write("\n")
    print("Calibration before/after proof passed; protected sources unchanged.")


if __name__ == "__main__":
    main()
