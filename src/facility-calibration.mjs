// Planar camera-frame -> facility ground-plane calibration.
// Local, numeric, deterministic; not lens distortion, 3D depth, camera pose, or identity.
// Image coordinates are fractions of the sampled raster; ground coordinates are metres east/north.
const DIM = 8;
const EPS = 1e-11;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const multiply = (a,b) => Array.from({length:9}, (_,k)=>{
  const row=Math.floor(k/3),col=k%3;
  return a[row*3]*b[col]+a[row*3+1]*b[3+col]+a[row*3+2]*b[6+col];
});

function pair(value) {
  if (!value || !value.image || !value.ground) throw new RangeError('A point needs image and ground coordinates.');
  const {x,y}=value.image, {x:east,y:north}=value.ground;
  if (![x,y,east,north].every(finite) || x<0 || x>1 || y<0 || y>1 ||
      Math.abs(east)>2000 || Math.abs(north)>2000) throw new RangeError('Reference coordinates are out of bounds.');
  if (value.role !== 'fit' && value.role !== 'check') throw new RangeError('Choose a fit or independent-check reference.');
  return {role:value.role,image:[x,y],ground:[east,north]};
}
function normalize(points) {
  const mean=[points.reduce((sum,p)=>sum+p[0],0)/points.length,points.reduce((sum,p)=>sum+p[1],0)/points.length];
  const average=points.reduce((sum,p)=>sum+distance(p,mean),0)/points.length;
  if (average<EPS) throw new RangeError('Reference points are too close together.');
  const scale=Math.SQRT2/average;
  return {
    points:points.map(p=>[(p[0]-mean[0])*scale,(p[1]-mean[1])*scale]),
    forward:[scale,0,-mean[0]*scale,0,scale,-mean[1]*scale,0,0,1],
    inverse:[1/scale,0,mean[0],0,1/scale,mean[1],0,0,1]
  };
}
function solveLeastSquares(rows, rhs) {
  // Householder QR: more stable than normal equations on a normalized DLT design.
  const m=rows.length, a=rows.map(row=>row.slice()), b=rhs.slice();
  let first=0,least=Infinity;
  for (let j=0;j<DIM;j++) {
    const norm=Math.hypot(...a.slice(j).map(row=>row[j]));
    if (!finite(norm) || norm<EPS) throw new RangeError('Reference geometry is degenerate.');
    const sign=a[j][j]>=0?1:-1, v=a.slice(j).map(row=>row[j]);
    v[0]+=sign*norm;
    const v2=v.reduce((sum,n)=>sum+n*n,0);
    if (!finite(v2)||v2<EPS) throw new RangeError('Reference geometry is singular.');
    for (let col=j;col<DIM;col++) {
      let projection=0;for(let i=0;i<v.length;i++)projection+=v[i]*a[j+i][col];
      const factor=2*projection/v2;
      for(let i=0;i<v.length;i++)a[j+i][col]-=factor*v[i];
    }
    let projection=0;for(let i=0;i<v.length;i++)projection+=v[i]*b[j+i];
    const factor=2*projection/v2;
    for(let i=0;i<v.length;i++)b[j+i]-=factor*v[i];
    const pivot=Math.abs(a[j][j]);
    if (j===0) first=pivot;
    least=Math.min(least,pivot);
  }
  if(least<first*1e-9)throw new RangeError('References form an ill-conditioned plane.');
  const x=new Array(DIM).fill(0);
  for(let i=DIM-1;i>=0;i--){
    let value=b[i];
    for(let j=i+1;j<DIM;j++)value-=a[i][j]*x[j];
    x[i]=value/a[i][i];
    if(!finite(x[i]))throw new RangeError('The planar transform is unstable.');
  }
  return x;
}
export function projectGround(matrix, imagePoint) {
  if (!Array.isArray(matrix)||matrix.length!==9||!matrix.every(finite)||
      !Array.isArray(imagePoint)||imagePoint.length!==2||!imagePoint.every(finite)) return null;
  const [x,y]=imagePoint,d=matrix[6]*x+matrix[7]*y+matrix[8];
  if(!finite(d)||Math.abs(d)<1e-10)return null;
  const point=[(matrix[0]*x+matrix[1]*y+matrix[2])/d,(matrix[3]*x+matrix[4]*y+matrix[5])/d];
  return point.every(finite) ? point : null;
}
const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
function hull(points){
  const sorted=points.map(p=>p.slice()).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const lower=[],upper=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=EPS)lower.pop();lower.push(p);}
  for(const p of sorted.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=EPS)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
export function insideReferenceHull(point, vertices) {
  if(!Array.isArray(point)||point.length!==2||!point.every(finite)||!Array.isArray(vertices)||vertices.length<3)return false;
  const boundary=hull(vertices);
  if(boundary.length<3)return false;
  return boundary.every((p,i)=>cross(p,boundary[(i+1)%boundary.length],point)>=-1e-9);
}
export function fitPlanarCalibration(references) {
  if(!Array.isArray(references)||references.length<4||references.length>24)throw new RangeError('Use 4 to 24 references.');
  const all=references.map(pair),fit=all.filter(p=>p.role==='fit'),checks=all.filter(p=>p.role==='check');
  if(fit.length<4)throw new RangeError('At least four fitting references are required.');
  const src=fit.map(p=>p.image),dst=fit.map(p=>p.ground);
  // A withheld check must be a genuinely different observed marker, not a
  // recycled fitting point (or the same check entered twice).
  const reviewed=[];
  for(const check of checks) {
    if([...fit,...reviewed].some(reference=>
      distance(reference.image,check.image)<1e-5 ||
      distance(reference.ground,check.ground)<0.01)) {
      throw new RangeError('Independent check markers must be distinct from fitting and other check markers.');
    }
    reviewed.push(check);
  }
  for(const list of [src,dst])for(let i=0;i<list.length;i++)for(let j=0;j<i;j++)
    if(distance(list[i],list[j])<1e-7)throw new RangeError('Two fitting references coincide.');
  const bbox=list=>Math.max(...list.map(p=>p[0]))-Math.min(...list.map(p=>p[0]));
  const ymax=list=>Math.max(...list.map(p=>p[1]))-Math.min(...list.map(p=>p[1]));
  if(bbox(src)<0.02||ymax(src)<0.02||bbox(dst)<0.1||ymax(dst)<0.1 ||
      Math.abs(hull(src).reduce((sum,p,i,a)=>sum+p[0]*a[(i+1)%a.length][1]-p[1]*a[(i+1)%a.length][0],0))<1e-5)
    throw new RangeError('References must span a non-collinear portion of both planes.');
  const ns=normalize(src),nd=normalize(dst),rows=[],rhs=[];
  for(let i=0;i<src.length;i++){
    const [u,v]=ns.points[i], [x,y]=nd.points[i];
    rows.push([u,v,1,0,0,0,-u*x,-v*x]);rhs.push(x);
    rows.push([0,0,0,u,v,1,-u*y,-v*y]);rhs.push(y);
  }
  const h=solveLeastSquares(rows,rhs),normal=[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
  let matrix=multiply(nd.inverse,multiply(normal,ns.forward));
  if(!matrix.every(finite)||Math.abs(matrix[8])<EPS)throw new RangeError('The normalized transform is unbounded.');
  matrix=matrix.map(v=>v/matrix[8]);
  // The projective denominator is affine in image x/y. Its extrema on a
  // convex reference hull occur at vertices. A zero between the extrema
  // puts an invisible projective horizon inside the measured working area.
  const boundary=hull(src);
  const denominators=boundary.map(([x,y])=>matrix[6]*x+matrix[7]*y+matrix[8]);
  const minD=Math.min(...denominators),maxD=Math.max(...denominators);
  const boundD=Math.max(Math.abs(minD),Math.abs(maxD),1);
  if((minD<=0&&maxD>=0)||Math.min(Math.abs(minD),Math.abs(maxD))<boundD*1e-7) {
    throw new RangeError('A projective horizon enters or approaches the reference area.');
  }
  const evaluate=points=>points.map(p=>{
    const predicted=projectGround(matrix,p.image);
    if(!predicted)throw new RangeError('A reference projects to infinity.');
    return distance(predicted,p.ground);
  });
  const fitErrors=evaluate(fit),checkErrors=evaluate(checks);
  const summary=errors=>errors.length?{
    count:errors.length,rmse:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),
    max:Math.max(...errors),mean:errors.reduce((s,e)=>s+e,0)/errors.length
  }:null;
  // No model-validation claim follows from fitting-point error alone.
  const fittingHull=boundary;
  const checkInsideHull=checks.length>0 && checks.every(p=>insideReferenceHull(p.image,fittingHull));
  return {matrix,fit:summary(fitErrors),holdout:summary(checkErrors),
    fittingHull,fittingCount:fit.length,checkCount:checks.length,checkInsideHull,
    verified:false, method:'normalized-householder-dlt-v1'};
}
export function calibratedGroundDistance(calibration,from,to) {
  if(!calibration || !Array.isArray(from)||!Array.isArray(to) ||
    !insideReferenceHull(from,calibration.fittingHull)||
    !insideReferenceHull(to,calibration.fittingHull))return null;
  const start=projectGround(calibration.matrix,from),end=projectGround(calibration.matrix,to);
  return start && end ? {metres:distance(start,end),start,end} : null;
}
