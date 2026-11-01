import {Marker} from 'maplibre-gl';
import {toLngLat,fromLngLat} from './facility.mjs';
import {floorDoorwayWalls,doorwayWall,doorwaySegment,placeDoorway,roomWallPieces} from './facility-doorways.mjs';
import {floorElevation,lineRibbonSegments} from './facility-measurements.mjs';
import {unitFactor} from './facility-shape-edit.mjs';
import {windowWall,windowSegment,cutWallPieces} from './facility-windows.mjs';

const collection=features=>({type:'FeatureCollection',features});
const line=(points,origin,properties={})=>({type:'Feature',geometry:{type:'LineString',coordinates:points.map(p=>toLngLat(p,origin))},properties});
export function createDoorwayMap(map,callbacks) {
  let context, walls=[], roomKey, marker, gesture=null, preview=null;
  function paint(doorPreview=preview) {
    if(!context)return;
    const {plan,selected,mode,floor,buildingId,flat,tool}=context;
    const building=plan.buildings.find(b=>b.id===buildingId);
    const active=mode==='floors' && building;
    const doors=(plan.doorways || []).filter(d=>d.buildingId===buildingId && d.level===floor);
    if(doorPreview) {
      const index=doors.findIndex(d=>d.id===doorPreview.id);
      if(index>=0) doors[index]=doorPreview;
    }
    const features=[];
    const windows=(plan.windows || []).filter(w=>active && w.buildingId===buildingId && w.level===floor).map(w=>({...w,segment:windowSegment(w,windowWall(plan,w))}));
    for(const room of active ? plan.rooms.filter(r=>r.buildingId===buildingId && r.level===floor) : []) {
      const base=floorElevation(building,floor,flat);
      const pieces=windows.length?cutWallPieces(room.footprint,room.wallHeight,[...windows,...doors.filter(d=>d.roomIds.includes(room.id))]):roomWallPieces(room,doors);
      for(const piece of pieces) {
        if(flat && piece.base>0)continue;
        for(const ring of lineRibbonSegments(piece.points,.14)) features.push({type:'Feature',
          geometry:{type:'Polygon',coordinates:[ring.map(p=>toLngLat(p,plan.origin))]},
          properties:{id:room.id,base:base+piece.base,top:flat?.05:base+piece.top}});
      }
    }
    map.getSource('rooms').setData(collection(features));
    map.getSource('doorway-walls').setData(collection(active && tool==='doorway' ? walls.map(w=>line(w.points,plan.origin)) : []));
    map.getSource('doorways').setData(collection(active ? doors.flatMap(d=>{
      const wall=doorwayWall(plan,d);
      if(!wall)return [];
      const base=floorElevation(building,floor,flat);
      return lineRibbonSegments(doorwaySegment(d,wall),.22).map(ring=>({type:'Feature',
        geometry:{type:'Polygon',coordinates:[ring.map(p=>toLngLat(p,plan.origin))]},
        properties:{id:d.id,selected:d.id===selected,base:base+.06,top:base+.08}}));
    }):[]));
    if(marker && doorPreview) marker.setLngLat(toLngLat([doorPreview.x,doorPreview.y],plan.origin));
  }
  function end(accept) {
    if(!gesture)return;
    document.removeEventListener('pointermove',move,true);
    document.removeEventListener('pointerup',up,true);
    document.removeEventListener('pointercancel',cancel,true);
    document.removeEventListener('keydown',escape,true);
    if(gesture.pan)map.dragPan.enable();
    const result=preview;gesture=null;preview=null;
    if(accept && result){callbacks.onMoveDoorway(result);paint(result);return;}
    paint();
    const door=context.plan.doorways?.find(d=>d.id===context.selected);
    if(marker && door)marker.setLngLat(toLngLat([door.x,door.y],context.plan.origin));
  }
  function move(event) {
    if(!gesture || event.pointerId!==gesture.pointerId)return;
    event.preventDefault();
    const box=map.getCanvasContainer().getBoundingClientRect(), ll=map.unproject([event.clientX-box.left,event.clientY-box.top]);
    try {
      preview=placeDoorway(context.plan,gesture.wall,fromLngLat([ll.lng,ll.lat],context.plan.origin).map((n,i)=>n+gesture.offset[i]),gesture.door);
      paint();
    } catch(e){callbacks.onError(e.message);}
  }
  function up(event){if(event.pointerId===gesture?.pointerId)end(true);}
  function cancel(){end(false);}
  function escape(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();end(false);}}
  function ensureHandle(door) {
    if(!door){end(false);marker?.remove();marker=null;return;}
    if(!marker) {
      const el=document.createElement('button');el.type='button';el.className='facility-doorway-handle';
      el.textContent='↔';el.setAttribute('aria-label','Drag doorway along wall');el.title='Drag along the wall · arrow keys move · Escape cancels drag';
      el.addEventListener('click',e=>e.stopPropagation());
      el.addEventListener('pointerdown',event=>{
        if(!event.isPrimary || event.button!==0 || gesture)return;
        event.preventDefault();event.stopPropagation();el.focus({preventScroll:true});
        const selected=context.plan.doorways.find(d=>d.id===context.selected),wall=doorwayWall(context.plan,selected);
        if(!wall)return;
        const box=map.getCanvasContainer().getBoundingClientRect(),ll=map.unproject([event.clientX-box.left,event.clientY-box.top]);
        const point=fromLngLat([ll.lng,ll.lat],context.plan.origin);
        gesture={door:selected,wall,pan:map.dragPan.isEnabled(),pointerId:event.pointerId,offset:[selected.x-point[0],selected.y-point[1]]};map.dragPan.disable();
        document.addEventListener('pointermove',move,{capture:true,passive:false});
        document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);
        document.addEventListener('keydown',escape,true);
      });
      el.addEventListener('keydown',event=>{
        const sign={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[event.key];if(!sign)return;
        event.preventDefault();event.stopPropagation();
        const selected=context.plan.doorways.find(d=>d.id===context.selected),wall=doorwayWall(context.plan,selected);
        if(!wall)return;
        const [a,b]=wall.points,length=Math.hypot(b[0]-a[0],b[1]-a[1]),step=sign*unitFactor(context.units)*(event.shiftKey?1:.1);
        try {callbacks.onMoveDoorway(placeDoorway(context.plan,wall,[selected.x+(b[0]-a[0])/length*step,selected.y+(b[1]-a[1])/length*step],selected));}
        catch(e){callbacks.onError(e.message);}
      });
      marker=new Marker({element:el}).setLngLat(toLngLat([door.x,door.y],context.plan.origin)).addTo(map);
    }
    if(!gesture)marker.setLngLat(toLngLat([door.x,door.y],context.plan.origin));
  }
  return {
    install() {
      for(const id of ['doorway-walls','doorways'])map.addSource(id,{type:'geojson',data:collection([])});
      map.addLayer({id:'doorway-walls',type:'line',source:'doorway-walls',paint:{'line-color':'#73e1c9','line-width':4,'line-opacity':.8}});
      map.addLayer({id:'doorways',type:'fill-extrusion',source:'doorways',paint:{'fill-extrusion-color':['case',['get','selected'],'#ffcf78','#d2fff3'],'fill-extrusion-base':['get','base'],'fill-extrusion-height':['get','top'],'fill-extrusion-opacity':.85}});
    },
    update(next) {
      context=next;
      if(next.tool==='doorway' && (roomKey!==next.plan.rooms || this.buildingId!==next.buildingId || this.floor!==next.floor)) {
        walls=floorDoorwayWalls(next.plan,next.buildingId,next.floor);roomKey=next.plan.rooms;this.buildingId=next.buildingId;this.floor=next.floor;
      }
      paint();
      ensureHandle(next.mode==='floors' && next.flat && next.editable!==false ? next.plan.doorways?.find(d=>d.id===next.selected && d.buildingId===next.buildingId && d.level===next.floor) : null);
    },
    pick(pixel,radius=16) {
      if(!context)return null;
      let nearest=null,best=radius;
      for(const wall of walls) {
        const [a,b]=wall.points.map(p=>map.project(toLngLat(p,context.plan.origin))),dx=b.x-a.x,dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((pixel.x-a.x)*dx+(pixel.y-a.y)*dy)/(dx*dx+dy*dy)));
        const d=Math.hypot(pixel.x-a.x-t*dx,pixel.y-a.y-t*dy);
        if(d<best){best=d;nearest=wall;}
      }
      return nearest;
    },
    destroy(){end(false);marker?.remove();marker=null;}
  };
}
