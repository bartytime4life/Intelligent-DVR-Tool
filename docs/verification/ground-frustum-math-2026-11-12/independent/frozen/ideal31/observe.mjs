import fs from 'node:fs';
import {blankFacility,validateFacility,groundRange,coverageFan,seesPoint,pointInPolygon,polygonArea,rehearse} from './snapshot/src/facility.mjs';
import {coverageMetrics} from './snapshot/src/facility-coverage.mjs';
const inputs=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const result=inputs.cases.map(test=>{
 const c=test.camera,b=c.bearing*Math.PI/180;
 const world=([X,Y])=>[c.x+X*Math.cos(b)+Y*Math.sin(b),c.y-X*Math.sin(b)+Y*Math.cos(b)];
 const plan={...blankFacility(),name:test.id,cameras:[c],route:(test.localRoute||[]).map(world),zones:test.localZone?[{id:'Z',name:'Generated zone',footprint:test.localZone.map(world),type:'restricted',dwellSeconds:0,expectedClasses:['person'],enabled:true}]:[]};
 const clean=validateFacility(plan),fan=coverageFan(c,[]),metrics=coverageMetrics(clean,()=>fan);
 return {id:test.id,validated:true,groundRange:groundRange(c),fan,fanArea:polygonArea(fan),points:test.localPoints.map(point=>{const p=world(point);return{local:point,world:p,seesPoint:seesPoint(c,p,[]),inDrawnFan:pointInPolygon(p,fan)}}),metrics,rehearsal:rehearse(clean,3)};
});
process.stdout.write(JSON.stringify(result));
