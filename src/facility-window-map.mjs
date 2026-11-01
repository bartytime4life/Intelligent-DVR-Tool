import {Marker} from 'maplibre-gl';
import {toLngLat,fromLngLat} from './facility.mjs';
import {floorElevation,lineRibbonSegments,formatDistance} from './facility-measurements.mjs';
import {unitFactor} from './facility-shape-edit.mjs';
import {exteriorWindowWalls,windowWall,windowSegment,windowFloorHeight,moveWindow,placeWindow,resizeWindow,cutWallPieces} from './facility-windows.mjs';

const collection=features=>({type:'FeatureCollection',features});
const positions=['start','move','end'];
const labels={start:'Resize window start',move:'Move window along wall',end:'Resize window end'};
export function createWindowMap(map,{onChange,onError,onLayout}) {
  let context=null,walls=[],handles=[],gesture=null,preview=null,active=null,activeWall=null;
  function geometry(draft=preview) {
    const {plan,mode,floor,buildingId,flat,tool}=context,shell=[],panes=[];
    const ribbon=(out,points,thickness,base,top,props)=>{
      for(const ring of lineRibbonSegments(points,thickness))out.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring.map(p=>toLngLat(p,plan.origin))]},properties:{...props,base,top}});
    };
    for(const building of plan.buildings) {
      if(mode==='floors' && building.id!==buildingId || mode==='2d')continue;
      const windows=(plan.windows || []).filter(w=>w.buildingId===building.id && (mode==='3d' || w.level===floor)).map(w=>draft?.id===w.id?draft:w);
      if(!windows.length)continue;
      const rise=windowFloorHeight(building),base=mode==='3d'?(building.base || 0):floorElevation(building,floor,flat);
      const wallHeight=mode==='3d'?building.height-base:rise;
      const apertures=windows.flatMap(w=>{
        const wall=windowWall(plan,w);if(!wall)return [];
        const segment=windowSegment(w,wall),sill=w.sill+(mode==='3d'?w.level*rise:0);
        const props={id:w.id,selected:w.id===context.selected,frame:false};
        ribbon(panes,segment,.25,flat?.13:base+sill,flat?.16:base+sill+w.height,props);
        if(flat){
          const [a,b]=segment,normal=[(a[1]-b[1])/w.width,(b[0]-a[0])/w.width];
          for(const end of segment)ribbon(panes,[-1,1].map(sign=>end.map((n,i)=>n+normal[i]*sign*.23)),.08,.14,.18,{...props,frame:true});
        } else {
          for(const z of [sill,sill+w.height-Math.min(.05,w.height)])ribbon(panes,segment,.28,base+z,base+z+.05,{...props,frame:true});
        }
        return [{...w,sill,segment}];
      });
      for(const ring of [building.footprint,...(building.holes || [])]) {
        // In plan view the whole sash is visible regardless of sill height.
        const cuts=flat?apertures.map(w=>({...w,sill:0,height:wallHeight})):apertures;
        for(const piece of cutWallPieces(ring,wallHeight,cuts))ribbon(shell,piece.points,.16,flat?.04:base+piece.base,flat?.08:base+piece.top,{id:building.id});
      }
    }
    map.getSource('window-shell').setData(collection(shell));map.getSource('windows').setData(collection(panes));
    map.getSource('exterior-wall-highlight').setData(collection(tool==='window' && mode==='floors'?walls.map(w=>({type:'Feature',geometry:{type:'LineString',coordinates:w.points.map(p=>toLngLat(p,plan.origin))},properties:{}})):[]));
  }
  function rects(){
    return handles.flatMap(m=>[m.getElement(),...m.getElement().querySelectorAll('.window-width-badge')].map(el=>el.getBoundingClientRect()));
  }
  function layout(w=preview || active) {
    if(!w || !activeWall || handles.length!==3)return;
    const [a,b]=windowSegment(w,activeWall),origin=context.plan.origin;
    const [s,e]=[a,b].map(p=>map.project(toLngLat(p,origin))),length=Math.hypot(e.x-s.x,e.y-s.y),pad=Math.max(0,32-length/2);
    const u=length?[(e.x-s.x)/length,(e.y-s.y)/length]:[1,0];
    for(const [i,p] of [a,[w.x,w.y],b].entries()) {
      const marker=handles[i],side=i-1;
      marker.setLngLat(toLngLat(p,origin)).setOffset(u.map(n=>n*side*pad));
      if(side)marker.getElement().style.cursor=Math.abs(u[0])>.8?'ew-resize':Math.abs(u[1])>.8?'ns-resize':u[0]*u[1]>0?'nwse-resize':'nesw-resize';
    }
    const grip=handles[1].getElement();grip.classList.toggle('badge-side',Math.abs(u[1])>.65);
    grip.lastChild.textContent=formatDistance(w.width,context.units);onLayout?.();
  }
  function localPoint(event){const r=map.getCanvas().getBoundingClientRect(),p=map.unproject([event.clientX-r.left,event.clientY-r.top]);return fromLngLat([p.lng,p.lat],context.plan.origin);}
  function adjust(role,w,wall,point){return role==='move'?moveWindow(context.plan,wall,w,point):resizeWindow(context.plan,wall,w,role,point);}
  function move(event){
    if(!gesture || gesture.pointerId!==event.pointerId)return;
    event.preventDefault();const g=gesture;
    try{preview=adjust(g.role,g.item,g.wall,localPoint(event).map((n,i)=>n+g.offset[i]));geometry();layout();}
    catch(e){onError(e.message);}
  }
  function finish(accept) {
    if(!gesture)return;
    document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);
    document.removeEventListener('pointercancel',cancel,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('blur',cancel);
    if(gesture.pan)map.dragPan.enable();
    const result=preview;gesture=null;preview=null;
    if(accept && result){active=result;onChange(result);}
    geometry(accept?result:null);layout();
  }
  function up(e){if(gesture?.pointerId===e.pointerId)finish(true);}
  function cancel(){finish(false);}
  function escape(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}}
  function begin(event,role){
    if(gesture || !active || !activeWall || !event.isPrimary || event.button!==0)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
    const point=localPoint(event),target=role==='move'?[active.x,active.y]:windowSegment(active,activeWall)[role==='start'?0:1];
    gesture={role,item:active,wall:activeWall,pointerId:event.pointerId,pan:map.dragPan.isEnabled(),offset:target.map((n,i)=>n-point[i])};map.dragPan.disable();
    document.addEventListener('pointermove',move,{capture:true,passive:false});document.addEventListener('pointerup',up,true);
    document.addEventListener('pointercancel',cancel,true);document.addEventListener('keydown',escape,true);window.addEventListener('blur',cancel);
  }
  function nudge(event,role){
    if(!active || !activeWall)return;
    const sign={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1}[event.key];if(!sign)return;
    event.preventDefault();event.stopPropagation();
    const [a,b]=activeWall.points,len=Math.hypot(b[0]-a[0],b[1]-a[1]),step=sign*unitFactor(context.units)*(event.shiftKey?1:.1);
    const target=role==='move'?[active.x,active.y]:windowSegment(active,activeWall)[role==='start'?0:1];
    try{onChange(adjust(role,active,activeWall,target.map((n,i)=>n+step*(b[i]-a[i])/len)));}catch(e){onError(e.message);}
  }
  function clearHandles(){for(const m of handles)m.remove();handles=[];}
  function syncHandles(){
    if(!active || !activeWall){clearHandles();return;}
    if(!handles.length)handles=positions.map(role=>{
      const el=document.createElement('button');el.type='button';el.className='facility-window-handle window-'+role;
      el.setAttribute('aria-label',labels[role]);el.title=labels[role]+' · drag or use arrow keys';
      el.textContent=role==='move'?'✥':'◆';
      if(role==='move'){const badge=document.createElement('span');badge.className='window-width-badge';badge.setAttribute('aria-hidden','true');el.append(badge);}
      el.addEventListener('click',e=>e.stopPropagation());el.addEventListener('pointerdown',e=>begin(e,role));el.addEventListener('keydown',e=>nudge(e,role));
      return new Marker({element:el,subpixelPositioning:true}).setLngLat(toLngLat([active.x,active.y],context.plan.origin)).addTo(map);
    });layout();
  }
  const onViewMove=()=>layout();
  return {
    install(){
      for(const id of ['window-shell','windows','exterior-wall-highlight','window-hover'])map.addSource(id,{type:'geojson',data:collection([])});
      const extrusion=(id,color,opacity)=>map.addLayer({id,type:'fill-extrusion',source:id,paint:{'fill-extrusion-color':color,'fill-extrusion-height':['get','top'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':opacity}});
      extrusion('window-shell','#56717b',.88);extrusion('windows',['case',['get','frame'],'#d5f6ff',['get','selected'],'#70ecff','#68c7f2'],.89);
      map.addLayer({id:'exterior-wall-highlight',type:'line',source:'exterior-wall-highlight',paint:{'line-color':'#83d9ff','line-width':4,'line-opacity':.9}});
      map.addLayer({id:'window-hover',type:'line',source:'window-hover',paint:{'line-color':'#e1faff','line-width':8,'line-opacity':.95}});
      map.on('move',onViewMove);
    },
    update(next){
      if(gesture && (next.selected!==context.selected || next.mode!==context.mode || next.floor!==context.floor || !next.editable))cancel();
      context=next;map.getSource('window-hover').setData(collection([]));const building=next.plan.buildings.find(b=>b.id===next.buildingId);
      walls=next.tool==='window'?exteriorWindowWalls(building,next.floor):[];
      active=next.mode==='floors' && next.flat && next.editable?next.plan.windows?.find(w=>w.id===next.selected && w.buildingId===next.buildingId && w.level===next.floor):null;
      activeWall=active?windowWall(next.plan,active):null;
      geometry();syncHandles();
    },
    pick(pixel){
      let nearest=null,best=17;
      for(const wall of walls){const [a,b]=wall.points.map(p=>map.project(toLngLat(p,context.plan.origin))),dx=b.x-a.x,dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((pixel.x-a.x)*dx+(pixel.y-a.y)*dy)/(dx*dx+dy*dy)));
        const d=Math.hypot(pixel.x-a.x-t*dx,pixel.y-a.y-t*dy);if(d<best){best=d;nearest=wall;}}
      return nearest;
    },
    rects,
    hover(pixel,point){
      if(context?.tool!=='window')return;
      const wall=pixel && this.pick(pixel);let feature=null;
      if(wall)try{
        const [a,b]=wall.points,width=Math.min(1.5,Math.hypot(b[0]-a[0],b[1]-a[1]));
        const w=placeWindow(context.plan,wall,point,{width});
        feature={type:'Feature',geometry:{type:'LineString',coordinates:windowSegment(w,wall).map(p=>toLngLat(p,context.plan.origin))},properties:{}};
      }catch{/* No free span at this width. */}
      map.getSource('window-hover').setData(collection(feature?[feature]:[]));
    },
    destroy(){cancel();clearHandles();map.off('move',onViewMove);}
  };
}
