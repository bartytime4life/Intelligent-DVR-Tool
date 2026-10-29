import test from 'node:test';
import assert from 'node:assert/strict';
import {studyTemplate,summarizeStudy} from '../scripts/facility-study.mjs';
const session=(n,flow,extra={})=>({participant_id:'P'+n,flow,completed:true,unaided:true,geometry_reviewed:true,estimated_heights_identified:true,seconds:120,corrections:0,...extra});
const observed=()=>{const d=studyTemplate();d.source_revision='a'.repeat(40);d.observer_id='O1';d.site_reference='warehouse-reference';return d;};
test('an empty study and unavailable imagery flow cannot become measured acceptance',()=>{
  const r=summarizeStudy(studyTemplate());assert.equal(r.acceptance,'open');assert.equal(r.participants,0);
  assert.equal(r.flows[0].target_met,null);assert.equal(r.flows[1].status,'unavailable');
});
test('five to eight distinct novices are required and sessions cannot be duplicated or fabricated for unavailable flows',()=>{
  const d=observed();d.sessions=[session(1,'open-footprints')];assert.equal(summarizeStudy(d).flows[0].status,'insufficient-sessions');
  d.sessions.push(session(1,'open-footprints'));assert.throws(()=>summarizeStudy(d));
  d.sessions=[session(1,'imagery-assisted')];assert.throws(()=>summarizeStudy(d));
  d.sessions=[session(9,'open-footprints')];assert.throws(()=>summarizeStudy(d));
});
test('failed and aided attempts stay in denominators and timing; height identification is required',()=>{
  const d=observed();d.sessions=Array.from({length:5},(_,i)=>session(i+1,'open-footprints',{seconds:[100,110,120,190,300][i],unaided:i!==4}));
  let r=summarizeStudy(d).flows[0];assert.equal(r.unaided_completion,0.8);assert.equal(r.median_attempt_seconds,120);assert.equal(r.target_met,true);
  d.sessions[0].geometry_reviewed=false;assert.equal(summarizeStudy(d).flows[0].target_met,false);
  d.sessions[0].geometry_reviewed=true;d.sessions[0].estimated_heights_identified=false;assert.equal(summarizeStudy(d).flows[0].target_met,false);
});
test('unavailable third flow keeps comparison open and incomplete cohorts cannot be compared',()=>{
  const d=observed();d.sessions=Array.from({length:5},(_,i)=>session(i+1,'open-footprints'));
  let r=summarizeStudy(d);assert.equal(r.comparison_complete,false);assert.equal(r.acceptance,'open');
  d.flows[1].available=true;
  for(const flow of ['imagery-assisted','manual-private-file'])for(let i=1;i<=5;i++)d.sessions.push(session(i,flow));
  r=summarizeStudy(d);assert.equal(r.comparison_complete,true);assert.equal(r.acceptance,'measured-review-required');
});
