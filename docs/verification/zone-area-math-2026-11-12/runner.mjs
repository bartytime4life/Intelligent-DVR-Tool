import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [modulePath,inputPath,outputPath]=process.argv.slice(2);
const {zoneCoverage}=await import(pathToFileURL(modulePath));
const corpus=JSON.parse(fs.readFileSync(inputPath,'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const observations=[];
for(const item of corpus.cases){
 const before=sha(JSON.stringify(item));
 try{
  const result=zoneCoverage(item.footprint,item.fans,item.options);
  const resolutionVariants=[1,97].map(maxCells=>({maxCells,result:zoneCoverage(item.footprint,item.fans,{...item.options,blindSpots:false,maxCells})}));
  observations.push({id:item.id,result,resolutionVariants,inputUnchanged:before===sha(JSON.stringify(item))});
 }catch(error){observations.push({id:item.id,error:String(error),inputUnchanged:before===sha(JSON.stringify(item))});}
}
fs.writeFileSync(outputPath,JSON.stringify({observations},(key,value)=>typeof value==='number'&&!Number.isFinite(value)?{nonfinite:String(value)}:value,2)+'\n');
