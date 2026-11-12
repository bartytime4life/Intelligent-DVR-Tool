const bits=new DataView(new ArrayBuffer(8));
function dyadic(value){
 bits.setFloat64(0,value);
 const raw=bits.getBigUint64(0),exp=Number((raw>>52n)&2047n),frac=raw&((1n<<52n)-1n);
 return {m:(raw>>63n ? -1n:1n)*(exp ? (1n<<52n)+frac:frac),e:exp ? exp-1075:-1074};
}
export function orientationSign(o,a,b){
 const numbers=[...o,...a,...b].map(dyadic),nonzero=numbers.filter(n=>n.m!==0n);
 const exponent=nonzero.length ? Math.min(...nonzero.map(n=>n.e)):0;
 const [ox,oy,ax,ay,bx,by]=numbers.map(n=>n.m===0n?0n:n.m<<BigInt(n.e-exponent));
 const det=(ax-ox)*(by-oy)-(ay-oy)*(bx-ox);
 return det>0n?1:det<0n?-1:0;
}
const ordinary=[[.1,.2],[.7,.9],[.8,.3]],tiny=[[0,0],[Number.MIN_VALUE,0],[0,Number.MIN_VALUE]],huge=[[-Number.MAX_VALUE,0],[Number.MAX_VALUE,0],[0,Number.MAX_VALUE]];
const start=performance.now();let total=0;
for(let i=0;i<100000;i++)total+=orientationSign(...ordinary);
console.log(JSON.stringify({ordinary:orientationSign(...ordinary),tiny:orientationSign(...tiny),huge:orientationSign(...huge),zero:orientationSign([0,-0],[0,0],[-0,0]),queries:100000,milliseconds:performance.now()-start,total}));
