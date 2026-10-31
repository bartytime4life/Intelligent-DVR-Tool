import test from 'node:test';
import assert from 'node:assert/strict';
import { recognitionFixture, sharpeningFixture } from './fixtures/recognition.mjs';
import { parseRecognition, frameSummary } from '../src/recognition.mjs';
import { recognitionReport, reportHTML, comparisonCSV } from '../src/recognition-report.mjs';

test('paired display and reports retain original events and separate candidate counts',()=>{
  const fixture=sharpeningFixture(), before=structuredClone(fixture), run=parseRecognition(fixture);
  const report=recognitionReport(run,{threshold:.5});
  assert.equal(run.enhancement.profile,'mild-unsharp-v1');
  assert.deepEqual(run.receipt.events,recognitionFixture().receipt.events);
  assert.equal(frameSummary(run.trace.frames[1]).detections.length,0);
  assert.equal(frameSummary({detections:run.trace.frames[1].comparison.detections}).detections.length,1);
  assert.deepEqual(report.enhancement_comparison.classes,[
    {label:'car',original:1,sharpened:0},{label:'person',original:1,sharpened:0},{label:'truck',original:0,sharpened:1}]);
  assert.equal(report.enhancement_comparison.qualification,'unqualified');
  assert.equal(report.enhancement_comparison.mean_enhanced_processing_ms,14);
  assert.match(reportHTML(report),/Original-only rule observations/);
  assert.match(reportHTML(report),/More detections do not establish better accuracy/);
  const csv=comparisonCSV(report);
  assert.equal(csv.trim().split('\r\n').length,3);
  assert.match(csv,/enhanced_pixels_sha256/);
  assert.match(csv,/'?mild-unsharp-v1/);
  assert.deepEqual(fixture,before);
});

test('old review files remain usable; malformed paired provenance fails closed',()=>{
  assert.equal(parseRecognition(recognitionFixture()).enhancement,null);
  const changes=[
    v=>delete v.trace.enhancement_comparison,
    v=>{v.receipt.enhancement_comparison=null;},
    v=>delete v.trace.frames[0].comparison,
    v=>{v.trace.enhancement_comparison.implementation_sha256='a'.repeat(64);},
    v=>{v.receipt.enhancement_comparison.parameters.scale=true;},
    v=>{v.trace.frames[0].comparison.enhancement_ms=15;},
    v=>{v.trace.frames[0].comparison.source_pixels_sha256='bad';},
    v=>{v.trace.frames[0].comparison.enhanced_processing_ms=NaN;},
    v=>{v.trace.frames[1].comparison.detections[0].box=[.9,0,.5,.1];},
    v=>{v.trace.frames[1].comparison.detections[0].score=.09;},
    v=>{v.trace.frames[0].comparison.detections=Array(100001).fill({});},
    v=>{delete v.receipt.enhancement_comparison;delete v.trace.enhancement_comparison;},
  ];
  for(const change of changes){const v=sharpeningFixture();change(v);assert.throws(()=>parseRecognition(v));}
});

test('candidate text is escaped in offline reports and thresholds affect both counts only',()=>{
  const v=sharpeningFixture();v.trace.frames[1].comparison.detections[0].label='<img src=x onerror=alert(1)>';
  const run=parseRecognition(v),report=recognitionReport(run,{threshold:.9});
  assert.equal(report.enhancement_comparison.classes.some(c=>c.sharpened>0),false);
  assert.equal(report.observations.length,1);
  const html=reportHTML(recognitionReport(run));assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);
});
