import test from 'node:test';
import assert from 'node:assert/strict';
import { recognitionFixture } from './fixtures/recognition.mjs';
import { parseRecognition } from '../src/recognition.mjs';
import { coverageLabel } from '../src/media-coverage.mjs';
import { recognitionReport, reportHTML, reportCSV } from '../src/recognition-report.mjs';

export function coverageFixture({status='inventory-matched',termination='source-end'}={}) {
  const v=recognitionFixture();
  const partial=status !== 'inventory-matched';v.receipt.state=v.trace.state=partial?'partial':'completed';
  const c={schema:'intelligent-dvr.media-coverage.v1',source_sha256:v.receipt.source_sha256,
    status,termination,analysis_frames:6,validated_frames:status==='not-checked'?0:6,
    declared_frames:partial?null:6,declared_duration_seconds:null,decoded_duration_seconds:null,
    duration_tolerance_seconds:null,anchor:partial?'none':'frames',validator_version:status==='not-checked'?null:'synthetic-fixture'};
  v.receipt.media_coverage=structuredClone(c);v.trace.media_coverage=structuredClone(c);return v;
}

test('new completed coverage needs matching source, counts, anchors and declarations',()=>{
  const v=coverageFixture();assert.equal(parseRecognition(v).coverage.status,'inventory-matched');
  const changes=[
    v=>{v.trace.media_coverage.analysis_frames=7;},
    v=>{v.receipt.media_coverage.source_sha256='f'.repeat(64);v.trace.media_coverage.source_sha256='f'.repeat(64);},
    v=>{v.receipt.media_coverage.declared_frames=7;v.trace.media_coverage.declared_frames=7;},
    v=>{delete v.trace.media_coverage;},
    v=>{for(const r of [v.receipt,v.trace])r.media_coverage.status='unverified';},
    v=>{for(const r of [v.receipt,v.trace])r.media_coverage={...r.media_coverage,declared_duration_seconds:3,decoded_duration_seconds:2,duration_tolerance_seconds:.001,anchor:'frames+duration'};},
    v=>{for(const r of [v.receipt,v.trace])r.media_coverage.analysis_frames=true;},
  ];
  for(const change of changes){const v=coverageFixture();change(v);assert.throws(()=>parseRecognition(v));}
});

test('unknown inventory, deliberate caps and legacy results carry different explanations',()=>{
  const unknown=parseRecognition(coverageFixture({status:'unverified'}));
  assert.match(coverageLabel(unknown.receipt),/completeness unverified/);
  assert.doesNotMatch(coverageLabel(unknown.receipt),/limit/);
  for(const termination of ['frame-limit','event-limit']){
    const run=parseRecognition(coverageFixture({status:'not-checked',termination}));
    assert.match(coverageLabel(run.receipt),/limit reached/);
  }
  const legacy=parseRecognition(recognitionFixture());
  assert.equal(legacy.coverage,null);assert.match(coverageLabel(legacy.receipt),/Legacy.*unverified/);
  const r=recognitionReport(unknown),html=reportHTML(r),csv=reportCSV(r);
  assert.equal(r.coverage.declaration.status,'unverified');assert.match(html,/completeness unverified/);
  assert.match(csv,/recording_coverage_status/);assert.match(csv,/"unverified","source-end"/);
  assert.equal(unknown.events.length,legacy.events.length);
});
