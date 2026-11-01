import React, {useEffect,useMemo,useRef,useState} from 'react';
import {Sha256} from './sha256.mjs';
import {fitPlanarCalibration,calibratedGroundDistance} from './facility-calibration.mjs';
import './facility-calibration.css';

const fresh=()=>Array.from({length:5},(_,i)=>({id:'p'+(i+1),role:i===4?'check':'fit',u:'',v:'',east:'',north:''}));
const valid=v=>v!==''&&v!==null&&Number.isFinite(Number(v));
const clamp=x=>Math.max(0,Math.min(1,x));
const pixel=event=>{const b=event.currentTarget.getBoundingClientRect();return [clamp((event.clientX-b.left)/b.width),clamp((event.clientY-b.top)/b.height)];};
const refs=rows=>rows.filter(p=>['u','v','east','north'].every(k=>valid(p[k]))).map(p=>({role:p.role,
  image:{x:Number(p.u)/100,y:Number(p.v)/100},
  ground:{x:Number(p.east),y:Number(p.north)}}));
function exportJSON(doc) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='facility-planar-calibration.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function FacilityCalibration({frame,slot='a',camera,facilityName,origin,mapPick,onRequestMapPoint}) {
  const [rows,setRows]=useState(fresh),[target,setTarget]=useState(''),[drag,setDrag]=useState('');
  const [solution,setSolution]=useState(null),[error,setError]=useState(''),[note,setNote]=useState('');
  const [confirmed,setConfirmed]=useState(false),[tolerance,setTolerance]=useState('.5');
  const [rulerMode,setRulerMode]=useState(false),[ruler,setRuler]=useState({start:null,end:null});
  const seq=useRef(5);
  // Ignore a prior map pick when a different camera/frame opens a new panel.
  const seenMapSerial=useRef(mapPick?.serial||0);
  const sampleHash=useMemo(()=>new Sha256().update(frame.image.data).hex(),[frame]);
  useEffect(()=>{setRows(fresh());seq.current=5;setSolution(null);setTarget('');setDrag('');setError('');
    setConfirmed(false);setNote('');setRulerMode(false);setRuler({start:null,end:null});},[frame]);
  useEffect(()=>{
    if(!mapPick?.serial || mapPick.serial<=seenMapSerial.current)return;
    seenMapSerial.current=mapPick.serial;
    const prefix=(camera?.id||'unbound')+':'+slot+':'+sampleHash+':';
    const id=mapPick?.token?.startsWith(prefix)?mapPick.token.slice(prefix.length):'';
    if(id&&Array.isArray(mapPick.point)&&mapPick.point.length===2&&mapPick.point.every(Number.isFinite)){
      setRows(list=>list.map(p=>p.id===id?{...p,east:mapPick.point[0].toFixed(3),north:mapPick.point[1].toFixed(3)}:p));
      setNote('Map point supplied. Confirm this corresponds to an independently measured ground marker.');
    }
  },[mapPick?.serial,sampleHash,camera?.id,slot]);
  const signature=JSON.stringify(rows);
  const fit=solution?.signature===signature&&solution?.sourceHash===sampleHash?solution.data:null;
  const limit=Number(tolerance);
  const accepted=!!fit?.holdout&&fit.checkInsideHull&&confirmed&&Number.isFinite(limit)&&limit>0&&limit<=25&&fit.holdout.max<=limit&&fit.fit.max<=limit;
  const distance=accepted&&ruler.start&&ruler.end?calibratedGroundDistance(fit,ruler.start,ruler.end):null;
  function setValue(id,field,value){setRows(list=>list.map(p=>p.id===id?{...p,[field]:value}:p));}
  function mark(id,[x,y]){setRows(list=>list.map(p=>p.id===id?{...p,u:(x*100).toFixed(2),v:(y*100).toFixed(2)}:p));}
  function down(e){
    if(e.button!==0)return;
    const pos=pixel(e);
    if(rulerMode&&accepted){setRuler(r=>!r.start||r.end?{start:pos,end:null}:{start:r.start,end:pos});return;}
    const id=e.target?.closest?.('[data-cal-ref]')?.dataset?.calRef||target;
    if(!id||!rows.some(p=>p.id===id))return;
    setTarget(id);mark(id,pos);setDrag(id);e.currentTarget.setPointerCapture(e.pointerId);
  }
  function compute(){
    setError('');setNote('');
    if(rows.some(p=>['u','v','east','north'].some(k=>p[k]!=='')&&!['u','v','east','north'].every(k=>valid(p[k])))){
      setError('Complete each partly entered point or clear its fields.');return;
    }
    try{
      const data=fitPlanarCalibration(refs(rows));
      setSolution({sourceHash:sampleHash,signature,data});setConfirmed(false);
      setRulerMode(false);setRuler({start:null,end:null});
      setNote(data.holdout?'Independent check residuals calculated. Verify the reference measurements.':
        'Fit-only result: an independent check is required before measuring distances.');
    }catch(e){setSolution(null);setError(e.message);}
  }
  function add(role){
    if(rows.length>=24)return;
    const id='p'+(++seq.current);
    setRows(list=>[...list,{id,role,u:'',v:'',east:'',north:''}]);setTarget(id);
  }
  function exportCalibration(){
    if(!fit)return;
    exportJSON({schema:'intelligent-dvr.planar-calibration.v1',method:fit.method,
      sourceSampleRGBAsha256:sampleHash,sampledImagePixels:[frame.image.width,frame.image.height],
      originalImagePixels:[frame.originalWidth,frame.originalHeight],
      cameraId:camera?.id||null,facilityName:facilityName||null,facilityOrigin:origin||null,
      plane:'operator-declared single measured ground plane',references:refs(rows),matrix:fit.matrix,
      fittingError:fit.fit,independentCheckError:fit.holdout,
      operatorDeclaredMeasured:confirmed,operatorToleranceMetres:limit,operatorAcceptance:accepted,
      ruler:distance?{image:ruler,metres:distance.metres}:null,
      limits:'Sampled-image SHA-256, not a source video hash. Editable unsigned calibration; not depth, height, lens distortion, identity, certified surveying or measured recognition accuracy.'});
  }
  return <details className="facility-calibration" aria-label="Ground-plane calibration">
    <summary><strong>Ground-plane calibration</strong><small>Match frame markers to measured facility points</small></summary>
    <div className="facility-calibration-body">
      <p className="facility-calibration-warning">Experimental planar reference tool. Only markers on one independently
        measured ground plane are eligible. Projecting people, walls or objects above the plane can give incorrect
        positions. No camera moves, inference or network requests are initiated here.</p>
      <p className="facility-calibration-note">{frame.image.width} × {frame.image.height} sampled pixels · SHA-256 of sampled
        RGBA data only. Use 4 fit points and at least one independently measured check point.</p>
      <div className="facility-calibration-actions"><button type="button" onClick={()=>add('fit')} disabled={rows.length>=24}>Add fit point</button>
        <button type="button" onClick={()=>add('check')} disabled={rows.length>=24}>Add check point</button></div>
      <div className="facility-calibration-image" role="group" aria-label="Select image calibration markers"
        style={{aspectRatio:frame.image.width+' / '+frame.image.height}}
        onPointerDown={down} onPointerMove={e=>drag&&mark(drag,pixel(e))}
        onPointerUp={e=>{setDrag('');if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
        onPointerCancel={()=>setDrag('')}>
        <img alt="Frozen frame with optional operator-selected reference markers" src={frame.preview} draggable="false"/>
        {rows.map((p,i)=>valid(p.u)&&valid(p.v) ? <button key={p.id} type="button" data-cal-ref={p.id}
          className={'facility-calibration-marker'+(p.id===target?' selected':'')}
          style={{left:p.u+'%',top:p.v+'%'}} title={'Drag point '+(i+1)}
          aria-label={'Drag image reference '+(i+1)} onClick={()=>setTarget(p.id)}>{i+1}</button> : null)}
      </div>
      <p className="facility-calibration-note">{rulerMode&&accepted
        ? 'Click the image twice to measure a line on the calibrated plane.'
        : 'Press Mark image, then click the frozen frame or drag its marker. Numeric controls work without a pointer.'}</p>
      <div className="facility-calibration-list" aria-label="Ground-plane calibration references">
        {rows.map((p,i)=><div className="facility-calibration-ref" key={p.id}>
          <div className="facility-calibration-ref-top"><strong>{i+1}. {p.role==='check'?'Independent check':'Fit point'}</strong>
            <div><button type="button" aria-pressed={target===p.id&&!rulerMode} onClick={()=>{setTarget(p.id);setRulerMode(false);}}>Mark image</button>
              <button type="button" disabled={!onRequestMapPoint} onClick={()=>{setTarget(p.id);setRulerMode(false);onRequestMapPoint?.((camera?.id||'unbound')+':'+slot+':'+sampleHash+':'+p.id);}}>Pick on map</button>
              <button type="button" aria-label={'Remove calibration point '+(i+1)} onClick={()=>{setRows(list=>list.filter(x=>x.id!==p.id));if(target===p.id)setTarget('');}}>×</button></div>
          </div>
          <div className="facility-calibration-fields">{[['u','Image X %',0,100],['v','Image Y %',0,100],['east','East metres',-2000,2000],['north','North metres',-2000,2000]].map(([key,label,min,max])=>
            <label key={key}>{label}<input aria-label={'Reference '+(i+1)+' '+label} type="number" step=".001" min={min} max={max}
              value={p[key]} onChange={e=>setValue(p.id,key,e.target.value)}/></label>)}</div>
        </div>)}
      </div>
      <div className="facility-calibration-actions"><button className="facility-calibration-primary" type="button" onClick={compute}>Compute planar transform</button>
        <button type="button" onClick={()=>{setRows(fresh());seq.current=5;setSolution(null);setConfirmed(false);setRuler({start:null,end:null});setError('');setNote('');setTarget('');}}>Reset references</button></div>
      {error&&<p role="alert" className="error">{error}</p>}
      {note&&<p role="status" className="facility-calibration-note">{note}</p>}
      {fit&&<section className="facility-calibration-results" aria-label="Fitted ground-plane transform">
        <h4>Calibration residuals — not field accuracy</h4>
        <p>Fit ({fit.fittingCount}): RMSE {fit.fit.rmse.toFixed(3)} m · max {fit.fit.max.toFixed(3)} m.</p>
        {fit.holdout?<p>Independent check ({fit.holdout.count}): RMSE <strong>{fit.holdout.rmse.toFixed(3)} m</strong>;
          maximum <strong>{fit.holdout.max.toFixed(3)} m</strong>.
          {fit.checkInsideHull?' All check points lie inside the reference hull.':' Some check points are outside the fitting boundary; measured distances remain locked.'}</p>
          :<p>No withheld check point. Ground distances cannot be enabled.</p>}
        <label className="facility-calibration-declaration"><input type="checkbox" checked={confirmed}
          onChange={e=>setConfirmed(e.target.checked)}/>
          I independently measured these markers and confirmed they are on one flat plane.</label>
        <label className="facility-calibration-tolerance">Maximum acceptable independent-check error (m)
          <input type="number" min=".01" max="25" step=".01" value={tolerance}
            aria-label="Maximum acceptable check error metres" onChange={e=>setTolerance(e.target.value)}/></label>
        <p className="facility-calibration-note">{accepted?
          'Operator-declared measured references meet the chosen tolerance. This is NOT survey or optics certification.':
          'Ground ruler locked until both fitting and withheld-check maxima meet the chosen threshold, using independently measured markers.'}</p>
        <div className="facility-calibration-actions"><button type="button" disabled={!accepted}
          onClick={()=>{setRulerMode(true);setTarget('');setRuler({start:null,end:null});}}>Measure within reference boundary</button>
          <button type="button" onClick={exportCalibration}>Export calibration JSON</button></div>
        {accepted&&<fieldset className="facility-calibration-ruler"><legend>Plane-only ruler · sampled image percentages</legend>
          {[[0,'start','Start X'],[1,'start','Start Y'],[0,'end','End X'],[1,'end','End Y']].map(([j,part,label])=><label key={part+j}>{label} %
            <input type="number" min="0" max="100" step=".01" aria-label={'Ground ruler '+label}
              value={ruler[part]?((ruler[part][j]||0)*100).toFixed(2):''}
              onChange={e=>setRuler(old=>({...old,[part]:
                [j===0?Number(e.target.value)/100:old[part]?.[0]??0,
                 j===1?Number(e.target.value)/100:old[part]?.[1]??0]}))}/></label>)}
          <p>{distance?<><strong>Plane-only estimated distance: {distance.metres.toFixed(2)} m ({(distance.metres*3.28084).toFixed(2)} ft)</strong>.
            Independent-check maximum residual: {fit.holdout.max.toFixed(3)} m.</>
            :'Choose two points within the convex hull of the fitting markers. Extrapolation is refused.'}</p>
        </fieldset>}
      </section>}
      <p className="facility-calibration-note">The exported calibration is editable metadata, not an authenticated chain of
        custody. The image hash identifies only the downsampled frozen frame. Calibration drafts are not automatically saved; export before switching frames or cameras. Lens distortion, elevation, uncertainty
        outside checked references and the original recording require separate validation.</p>
    </div>
  </details>;
}
