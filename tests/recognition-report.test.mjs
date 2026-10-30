import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognitionFixture } from './fixtures/recognition.mjs';
import { parseRecognition } from '../src/recognition.mjs';
import { recognitionReport, reportCSV, reportHTML } from '../src/recognition-report.mjs';

test('reports count repeated sampled detections and bind saved human decisions',()=>{
  const run=parseRecognition(recognitionFixture());
  const review={...run.events[0],status:'confirmed',note:'Reviewed the original frame.'};
  const r=recognitionReport(run,{reviews:[review],sourceMatched:true,threshold:.5});
  assert.equal(r.summary.detections,2); assert.equal(r.summary.samples_with_detections,1);
  assert.equal(r.summary.confirmed,1); assert.equal(r.summary.pending,0);
  assert.equal(r.observations[0].note,review.note);
  assert.equal(r.source.fingerprint_matched,true);
  assert.equal(r.classes.find(c=>c.label==='person').peak_in_sample,1);
  assert.equal(r.analysis.last_sample_seconds,.5);
});
test('partial coverage and unmatched sources remain explicit; filter does not alter rules',()=>{
  const fixture=recognitionFixture(); fixture.receipt.state=fixture.trace.state='partial';
  const run=parseRecognition(fixture), r=recognitionReport(run,{threshold:1});
  assert.equal(r.summary.detections,0); assert.equal(r.summary.observations,1);
  assert.equal(r.source.fingerprint_matched,false); assert.match(reportHTML(r),/PARTIAL/);
  assert.match(reportHTML(r),/Recording NOT matched/);
  assert.equal(fixture.trace.frames[0].detections.length,3);
});
test('reports refuse conflicting review identities and malformed threshold/provenance',()=>{
  const run=parseRecognition(recognitionFixture());
  assert.throws(()=>recognitionReport(run,{reviews:[{...run.events[0],rule:'different evidence'}]}),/conflicts/);
  assert.throws(()=>recognitionReport(run,{threshold:NaN}));
  run.trace.source_sha256='f'.repeat(64); assert.throws(()=>recognitionReport(run),/provenance/);
});
test('offline HTML escapes text and CSV neutralizes spreadsheet formulas',()=>{
  const run=parseRecognition(recognitionFixture());
  const r=recognitionReport(run,{sourceName:'<script>alert(1)</script>', reviews:[{...run.events[0],note:'  =HYPERLINK("https://evil.test")\n<img src=x onerror=alert(1)>',status:'dismissed'}]});
  const html=reportHTML(r),csv=reportCSV(r);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  assert.match(html,/&lt;script&gt;/); assert.match(html,/default-src 'none'/);
  assert.match(csv,/"'  =HYPERLINK\(""https:\/\/evil.test""\)/);
  assert.equal(r.summary.dismissed,1);
});
