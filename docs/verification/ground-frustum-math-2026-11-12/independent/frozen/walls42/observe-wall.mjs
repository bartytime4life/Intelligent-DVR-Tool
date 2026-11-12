import fs from 'node:fs';
import {validateFacility,blankFacility,coverageFan,seesPoint} from './snapshot/src/facility.mjs';
const [inputPath,mode]=process.argv.slice(2),inputs=JSON.parse(fs.readFileSync(inputPath,'utf8'));
const core=mode==='candidate'?await import('./snapshot/src/facility-visibility.mjs'):null;
const observed=inputs.cases.map(test=>{
 const c=test.camera,b=c.bearing*Math.PI/180,world=([x,y])=>[c.x+x*Math.cos(b)+y*Math.sin(b),c.y-x*Math.sin(b)+y*Math.cos(b)];
 const walls=test.localWalls.map(w=>({...w,polygon:w.polygon.map(world)}));
 let planValidated=null,planError=null;
 if(test.validatePlan){try{validateFacility({...blankFacility(),cameras:[c],buildings:walls.map((w,i)=>({id:'B'+i,name:'Generated wall building '+i,footprint:w.polygon,height:w.top,base:w.base,floors:1}))});planValidated=true;}catch(e){planValidated=false;planError=e.message;}}
 const fan=core?null:coverageFan(c,walls);
 const result=core?core.groundVisibility(c,walls,{segments:test.rangeSegments}):{method:'legacy-radial-fan-adapter',estimated:true,polygons:fan.length?[ [fan] ]:[]};
 return {id:test.id,planValidated,planError,result,points:test.localPoints.map(p=>({visible:core?core.visibleGroundPoint(c,world(p),walls):seesPoint(c,world(p),walls)}))};
});
process.stdout.write(JSON.stringify(observed));
