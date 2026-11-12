import fs from 'node:fs';
import {blankFacility,validateFacility} from './snapshot/src/facility.mjs';
import {planVisibility,visibleAtPoint,rehearseVisibility} from './snapshot/src/facility-visibility.mjs';
import {coverageMetrics} from './snapshot/src/facility-coverage.mjs';
import {acceptVisibilitySnapshot,visibilitySnapshotMatches} from './snapshot/src/facility-visibility-protocol.mjs';
const inputs=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out=inputs.cases.map(test=>{
 const c=test.camera,b=c.bearing*Math.PI/180,world=([x,y])=>[c.x+x*Math.cos(b)+y*Math.sin(b),c.y-x*Math.sin(b)+y*Math.cos(b)];
 const bound=c.range===1?[-1.2,-1.2,1.2,1.2]:[-12,-3,12,10];
 const [x,y,X,Y]=bound,zone={id:'Z',name:'Generated metrics zone',type:'restricted',footprint:[[x,y],[X,y],[X,Y],[x,Y],[x,y]].map(world),enabled:true,dwellSeconds:0,expectedClasses:['person']};
 // Identical poses have DISTINCT IDs. This checks same-footprint caching and
 // distinct-camera overlap while retaining all components/holes in each view.
 const plan=validateFacility({...blankFacility(),cameras:[{...c,id:'A'},{...c,id:'B'}],zones:[zone],route:[[0,y],[0,Y]].map(world)});
 const walls=test.localWalls.map(w=>({...w,polygon:w.polygon.map(world)}));
 const snapshot=planVisibility(plan,{obstacles:walls}),view=new Map(snapshot.cameras.map(c=>[c.id,c]));
 const clone=structuredClone(snapshot),cloneInitiallyUnbound=!visibilitySnapshotMatches(clone,plan),cloneAccepted=acceptVisibilitySnapshot(clone,plan);
 const unknown=planVisibility(plan,{obstacles:walls,limits:{operations:0}}),unknownViews=new Map(unknown.cameras.map(c=>[c.id,c]));
 return {id:test.id,metrics:coverageMetrics(plan,c=>view.get(c.id)),cacheHits:snapshot.cacheHits,snapshotBound:visibilitySnapshotMatches(snapshot,plan),otherPlanUnbound:!visibilitySnapshotMatches(snapshot,{...plan}),cloneInitiallyUnbound,cloneAccepted,cloneBound:visibilitySnapshotMatches(clone,plan),points:test.localPoints.map(p=>visibleAtPoint(snapshot,world(p))),unknown:{estimated:unknown.estimated,point:visibleAtPoint(unknown,world([0,0])),rehearsal:rehearseVisibility(plan,unknown,3),metrics:coverageMetrics(plan,c=>unknownViews.get(c.id))}};
});
process.stdout.write(JSON.stringify(out));
