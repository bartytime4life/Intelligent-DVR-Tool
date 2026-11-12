import fs from 'node:fs';
import {blankFacility,validateFacility,groundRange} from './snapshot/src/facility.mjs';
import {groundVisibility,visibleGroundPoint,planVisibility,rehearseVisibility,visibleAtPoint} from './snapshot/src/facility-visibility.mjs';
import {coverageMetrics} from './snapshot/src/facility-coverage.mjs';
import {visibilitySnapshotMatches} from './snapshot/src/facility-visibility-protocol.mjs';
const inputs=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const output=inputs.cases.map(test=>{
 const c=test.camera,b=c.bearing*Math.PI/180,world=([X,Y])=>[c.x+X*Math.cos(b)+Y*Math.sin(b),c.y-X*Math.sin(b)+Y*Math.cos(b)];
 const plan=validateFacility({...blankFacility(),name:test.id,cameras:[c],route:(test.localRoute||[]).map(world),zones:test.localZone?[{id:'Z',name:'Generated zone',footprint:test.localZone.map(world),type:'restricted',dwellSeconds:0,expectedClasses:['person'],enabled:true}]:[]});
 const result=groundVisibility(c,[]),snapshot=planVisibility(plan),views=new Map(snapshot.cameras.map(c=>[c.id,c]));
 return {id:test.id,validated:true,result,snapshotAccepted:visibilitySnapshotMatches(snapshot,plan),snapshotEstimated:snapshot.estimated,snapshotPolygonsEqual:JSON.stringify(result.polygons)===JSON.stringify(snapshot.cameras[0].polygons),groundRange:groundRange(c),points:test.localPoints.map(p=>({local:p,world:world(p),exactPoint:visibleGroundPoint(c,world(p),[]),snapshotPoint:visibleAtPoint(snapshot,world(p)).includes(c.id)})),metrics:coverageMetrics(plan,c=>views.get(c.id)),rehearsal:rehearseVisibility(plan,snapshot,3)};
});
process.stdout.write(JSON.stringify(output));
