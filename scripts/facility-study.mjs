// Observer-entered evidence only. No participant tracking, telemetry or invented observations.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const FLOWS=['open-footprints','imagery-assisted','manual-private-file'];
const median=xs=>{const sorted=[...xs].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
export function studyTemplate() {
  return {schema:'intelligent-dvr.facility-study.v1',source_revision:'',observer_id:'',site_reference:'',
    flows:FLOWS.map(id=>({id,available:id!=='imagery-assisted'})),sessions:[]};
}
export function summarizeStudy(data) {
  if(data?.schema!=='intelligent-dvr.facility-study.v1' || !Array.isArray(data.sessions) || data.sessions.length>24 ||
     !Array.isArray(data.flows) || data.flows.length!==3 || FLOWS.some(id=>data.flows.filter(f=>f.id===id && typeof f.available==='boolean').length!==1))throw Error('Invalid study contract.');
  if(data.sessions.length && (!/^[a-f0-9]{40}$/.test(data.source_revision) || !/^[A-Za-z0-9_-]{1,40}$/.test(data.observer_id) || !/^[A-Za-z0-9_-]{1,80}$/.test(data.site_reference)))throw Error('Observed sessions require a source revision, anonymous observer ID and site reference.');
  const keys=new Set(), participants=new Set();
  for(const s of data.sessions) {
    const key=s.participant_id+':'+s.flow;
    if(!/^P[1-8]$/.test(s.participant_id) || !FLOWS.includes(s.flow) || !data.flows.find(f=>f.id===s.flow).available || keys.has(key) ||
       !['completed','unaided','geometry_reviewed','estimated_heights_identified'].every(k=>typeof s[k]==='boolean') ||
       !Number.isFinite(s.seconds) || s.seconds<=0 || s.seconds>1800 || !Number.isInteger(s.corrections) || s.corrections<0 || s.corrections>1000)throw Error('Invalid, duplicate or unavailable-flow session.');
    keys.add(key);participants.add(s.participant_id);
  }
  const flows=data.flows.map(f=>{
    const sessions=data.sessions.filter(s=>s.flow===f.id),n=sessions.length;
    const success=sessions.filter(s=>s.completed && s.unaided && s.geometry_reviewed).length;
    const seconds=n?median(sessions.map(s=>s.seconds)):null;
    const measured=f.available && n>=5 && n<=8 && n===participants.size;
    return {id:f.id,status:!f.available?'unavailable':!n?'unmeasured':!measured?'insufficient-sessions':'observed',attempts:n,
      unaided_completion:n?success/n:null,median_attempt_seconds:seconds,median_corrections:n?median(sessions.map(s=>s.corrections)):null,
      target_met:measured?success/n>=0.8 && seconds<180 && sessions.every(s=>s.estimated_heights_identified):null};
  });
  return {schema:'intelligent-dvr.facility-study-summary.v1',source_revision:data.source_revision || null,participants:participants.size,
    evidence:'observer-entered; not independently authenticated',flows,
    comparison_complete:flows.every(f=>f.status==='observed'),acceptance:flows.every(f=>f.status==='observed')?'measured-review-required':'open'};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const mode=process.argv[2];
    if(mode==='template')process.stdout.write(JSON.stringify(studyTemplate(),null,2)+'\n');
    else if(mode==='summarize' && process.argv.length===4) {
      const raw=readFileSync(process.argv[3]);if(raw.length>100000)throw Error('Study exceeds 100 KB.');
      const report=summarizeStudy(JSON.parse(raw));process.stdout.write(JSON.stringify(report,null,2)+'\n');
      if(!report.comparison_complete)process.exitCode=3;
    } else throw Error('Use facility-study.mjs template | summarize PATH');
  } catch(error) {console.error(error.message);process.exitCode=2;}
}
