import React,{memo,useEffect,useRef,useState} from 'react';
import {boxBetween,snapSketchPoint} from './facility-room-sketch.mjs';
import {formatDistance} from './facility-measurements.mjs';
import {unitFactor} from './facility-shape-edit.mjs';

export const pathOf=ring=>'M'+ring.map(p=>p.join(',')).join(' L')+' Z';

// Place the text on an interior span, even when a clipped room is L-shaped.
function labelSpan(ring) {
  const ys=ring.map(p=>p[1]), low=Math.min(...ys), high=Math.max(...ys);
  let best=null;
  for (const fraction of [.5,.3,.7]) {
    const y=low+(high-low)*fraction, xs=[];
    for (let i=1;i<ring.length;i++) {
      const [a,b]=[ring[i-1],ring[i]];
      if ((a[1]>y)!==(b[1]>y)) xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    }
    xs.sort((a,b)=>a-b);
    for (let i=1;i<xs.length;i+=2) {
      const width=xs[i]-xs[i-1];
      if (!best || width>best.width) best={x:(xs[i]+xs[i-1])/2,y,width};
    }
  }
  return best;
}

export const RoomLabel=memo(function RoomLabel({room,scale,sizeRatio=.026}) {
  const span=labelSpan(room.ring);
  if (!span) return null;
  const font=Math.min(scale*sizeRatio,span.width/(room.name.length*.68+1));
  return font>scale*.009 && <text x={span.x} y={span.y} fontSize={font} dominantBaseline="central" textAnchor="middle">{room.name}</text>;
});

export default function RoomSketchCanvas({refPlan,floor,staged,rooms,box,units,snap,vertices,onBox,onLive,onDrawing}) {
  const [anchor,setAnchor]=useState(null), [hover,setHover]=useState(null);
  const press=useRef(null), svg=useRef(null);
  const pending=useRef(null),timer=useRef(0);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  function live(a,b) {
    if (!a) return;
    pending.current=boxBetween(a,b);
    if (!timer.current) timer.current=setTimeout(()=>{onLive(pending.current);timer.current=0;},65);
  }
  const {w,h}=floor.frame.box, span=Math.max(w,h), pad=span*.075;
  const unit=unitFactor(units), grid=unit*Math.max(1,10**Math.floor(Math.log10(span/unit/8)));
  const cursor=hover?.point ?? [w/2,h/2], liveBox=anchor && boxBetween(anchor,cursor), shownBox=liveBox || box;
  function fromEvent(e) {
    const matrix=svg.current.getScreenCTM();
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());
    const magnet=snap && !refPlan.source;
    return snapSketchPoint([p.x,p.y],magnet ? vertices : [],floor.frame.box,
      Math.min(8/matrix.a,span*.024),magnet ? unit : 0);
  }
  function start(point) {setAnchor(point);onDrawing(true);}
  function cancel() {clearTimeout(timer.current);timer.current=0;onLive(null);press.current=null;setAnchor(null);setHover(null);onDrawing(false);}
  function finish(a,b) {onBox(boxBetween(a,b));cancel();}
  function down(e) {
    if (!e.isPrimary || e.button!==0) return;
    e.preventDefault(); svg.current.focus({preventScroll:true});
    const cursor=fromEvent(e);
    press.current={point:cursor.point,x:e.clientX,y:e.clientY,anchored:!!anchor};
    svg.current.setPointerCapture(e.pointerId);
    setHover(cursor);
    if (!refPlan.aligning && !anchor) start(cursor.point);
  }
  function up(e) {
    const first=press.current;
    if (!first || !e.isPrimary) return;
    const point=fromEvent(e);
    press.current=null;
    setHover(point);
    if (refPlan.aligning){refPlan.mark(point.point);return;}
    if (first.anchored || Math.hypot(e.clientX-first.x,e.clientY-first.y)>5)
      finish(anchor ?? first.point,point.point);
  }
  function key(e) {
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
    if (delta) {
      e.preventDefault();
      const to=snapSketchPoint(cursor.map((n,i)=>n+delta[i]*unit*(e.shiftKey?10:1)),[],floor.frame.box,0,0);
      setHover(to);live(anchor,to.point);
    } else if (e.key==='Enter' || e.key===' ') {
      e.preventDefault(); if(refPlan.aligning)refPlan.mark(cursor);else if (anchor) finish(anchor,cursor); else start(cursor);
    } else if (e.key==='Escape' && anchor) {e.stopPropagation();e.preventDefault();cancel();}
  }
  const {fit,image,aligning,source,marks,matrix}=refPlan;
  const guides=aligning ? (source ? marks : marks.slice(2)) : [];
  const description=aligning ? refPlan.prompt : anchor ? 'Choose the opposite corner.' : 'Drag a box or tap two corners. With a keyboard, use arrows and Enter.';
  return <div className="room-sketch-paper">
    <div className="room-paper-heading"><span>{source?'REFERENCE IMAGE':'FLOOR PLAN'}</span><span>{source?'Choose two recognizable points':'Aligned to exterior wall'}</span></div>
    <svg ref={svg} className="room-drawing" role="group" aria-label="Room sketch canvas" aria-describedby="room-sketch-hint" tabIndex={0}
      viewBox={[-pad,-pad,w+2*pad,h+2*pad].join(' ')} onPointerDown={down} onPointerUp={up} onPointerCancel={cancel}
      onPointerMove={e=>{if(e.isPrimary){const to=fromEvent(e);setHover(to);live(anchor,to.point);}}} onPointerLeave={()=>{if(!anchor)setHover(null);}} onKeyDown={key}>
      <defs><clipPath id="sketch-building"><path d={pathOf(floor.outer)}/></clipPath><pattern id="sketch-grid" width={grid} height={grid} patternUnits="userSpaceOnUse"><path d={`M ${grid} 0 H 0 V ${grid}`} className="room-gridline"/></pattern>
        <pattern id="sketch-hatch" width={span*.022} height={span*.022} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="100%" height="100%" fill="#26303b"/><path d={`M 0 0 V ${span*.022}`} stroke="#9a8192" vectorEffect="non-scaling-stroke"/></pattern></defs>
      <path d={pathOf(floor.outer)} className="room-floor-shell"/>
      <path d={pathOf(floor.outer)} fill="url(#sketch-grid)"/>
      {image && (!aligning || source) && <g clipPath={source?undefined:'url(#sketch-building)'}><image href={image.url} x={fit.x} y={fit.y} width={fit.w} height={fit.h}
        transform={matrix && !source?'matrix('+matrix.join(' ')+')':undefined} opacity={source?1:refPlan.opacity} pointerEvents="none"/></g>}
      {!source && floor.blocked.map((r,i)=><g key={i}><path d={pathOf(r.ring)} className={'room-existing '+r.kind}><title>{r.name}</title></path></g>)}
      {!aligning && staged.map(r=><path key={r.name} d={pathOf(r.ring)} className="room-staged"/>)}
      {!aligning && rooms.map(r=><path key={r.name} d={pathOf(r.ring)} className="room-proposed"/>)}
      {!aligning && shownBox && <rect className="room-draw-box" x={shownBox.x} y={shownBox.y} width={shownBox.w} height={shownBox.h}/>}
      <g className="room-saved-labels">{!source && floor.blocked.filter(r=>r.kind==='room').map((r,i)=><RoomLabel key={i} room={r} scale={span}/>)}</g>
      <g className="room-plan-labels">{!aligning && [...staged,...rooms].map(r=><RoomLabel key={r.name} room={r} scale={span}/>)}</g>
      {guides.map(([x,y],i)=><g key={i} className="room-landmark"><circle cx={x} cy={y} r={span*.015}/><text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={span*.021}>{i?'B':'A'}</text></g>)}
      {hover && <g className="room-snap-guides">
        {hover.guides[0] && <line x1={cursor[0]} x2={cursor[0]} y1="0" y2={h}/>}
        {hover.guides[1] && <line y1={cursor[1]} y2={cursor[1]} x1="0" x2={w}/>}
        <circle cx={cursor[0]} cy={cursor[1]} r={span*.006}/>
      </g>}
    </svg>
    <div className="room-paper-caption"><span id="room-sketch-hint">{description}</span>
      {!aligning && shownBox && <strong>{formatDistance(shownBox.w,units)} × {formatDistance(shownBox.h,units)}</strong>}</div>
    <div className="room-map-legend"><span><i/>Proposed</span><span><i/>Existing room</span><span><i/>Opening or stair</span>{!!staged.length && <span><i/>Kept in sketch</span>}</div>
  </div>;
}
