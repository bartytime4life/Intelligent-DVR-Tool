import {Marker} from 'maplibre-gl';
import {fromLngLat,toLngLat} from './facility.mjs';
import {stairFootprint,stairLandingRings,stairTreadPolygons,validateStair} from './facility-stairs.mjs';
import {anchorStair,stairAnchors,turnStair,travelBearing,stairPlacementIssue} from './facility-stair-placement.mjs';
import {unitFactor} from './facility-shape-edit.mjs';

const fc=features=>({type:'FeatureCollection',features});
export function createStairMap(map,{change,requestLabels}) {
  let ctx,active=null,markers=[],drag=null,preview=null;
  const roles=['move','rotate'];
  function render(item=preview || active) {
    const features=[];
    if(item){
      const b=ctx.building,[start,end]=stairAnchors(item,b),bad=Boolean(stairPlacementIssue(ctx.plan,b,item));
      const coords=points=>points.map(p=>toLngLat(p,ctx.plan.origin));
      const add=(type,points,part)=>features.push({type:'Feature',geometry:{type,coordinates:type==='Polygon'?[coords(points)]:coords(points)},properties:{part,bad}});
      add('Polygon',stairFootprint(item,b),'run');
      stairLandingRings(item,b).forEach((ring,i)=>add('Polygon',ring,i?'arrival':'start'));
      for(const tread of stairTreadPolygons(item,b).slice(1))add('LineString',tread.footprint.slice(0,2),'tread');
      add('LineString',stairFootprint(item,b),'outline');add('LineString',[start,end],'direction');
    }
    map.getSource('stair-preview').setData(fc(features));layout(item);
  }
  function layout(item=preview || active){
    if(!item || !markers.length)return;
    const ends=stairAnchors(item,ctx.building).map(p=>toLngLat(p,ctx.plan.origin));
    const [a,b]=ends.map(p=>map.project(p)),d=Math.hypot(b.x-a.x,b.y-a.y),pad=Math.max(0,60-d);
    markers.forEach((m,i)=>m.setLngLat(ends[i]).setOffset(i && d?[pad*(b.x-a.x)/d,pad*(b.y-a.y)/d]:[0,0]));
    markers.forEach((m,i)=>{
      const loc=i?b:a,left=loc.x+100>map.getCanvas().clientWidth || (loc.x>85 && Math.abs(b.x-a.x)>.6*d && (i?b.x<a.x:a.x<b.x));
      m.getElement().classList.toggle('badge-left',left);
    });
    markers[1].getElement().lastChild.textContent='Turn · '+Math.round(travelBearing(item))+'°';
    requestLabels();
  }
  const refresh=()=>layout();
  const point=e=>{const r=map.getCanvas().getBoundingClientRect(),p=map.unproject([e.clientX-r.left,e.clientY-r.top]);return fromLngLat([p.lng,p.lat],ctx.plan.origin);};
  function down(e,role){
    if(drag || !active || !e.isPrimary || e.button!==0)return;
    e.preventDefault();e.stopPropagation();e.currentTarget.focus({preventScroll:true});
    const ends=stairAnchors(active,ctx.building),grab=point(e),grip=e.currentTarget.getBoundingClientRect();
    // At low zoom the turn grip extends beyond the landing. Rotate on its displayed
    // radius so the handle follows the finger even when the flight is very short.
    const target=role==='move'?ends[0]:point({clientX:grip.left+grip.width/2,clientY:grip.top+grip.height/2});
    drag={item:active,role,id:e.pointerId,start:ends[0],offset:target.map((v,i)=>v-grab[i]),pan:map.dragPan.isEnabled()};
    e.currentTarget.setPointerCapture(e.pointerId);
    map.dragPan.disable();
    document.addEventListener('pointermove',move,{capture:true,passive:false});
    document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);
    document.addEventListener('keydown',escape,true);window.addEventListener('blur',cancel);
  }
  function move(e){
    if(!drag || e.pointerId!==drag.id)return;e.preventDefault();const g=drag,p=point(e).map((n,i)=>n+g.offset[i]);
    if(g.role==='move')preview=anchorStair(g.item,ctx.building,p);
    else{
      if(Math.hypot(p[0]-g.start[0],p[1]-g.start[1])<.05)return;
      let head=Math.atan2(p[0]-g.start[0],p[1]-g.start[1])*180/Math.PI;if(e.shiftKey)head=Math.round(head/15)*15;
      preview=turnStair(g.item,ctx.building,head);
    }
    render();
  }
  function end(accept){
    if(!drag)return;
    document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);
    document.removeEventListener('pointercancel',cancel,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('blur',cancel);
    if(drag.pan)map.dragPan.enable();
    const result=preview;drag=null;preview=null;if(accept && result){active=result;change(result);}render();
  }
  function up(e){if(drag?.id===e.pointerId)end(true);}
  function cancel(){end(false);}
  function escape(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}}
  function key(e,role){
    if(!active || !e.key.startsWith('Arrow'))return;e.preventDefault();e.stopPropagation();
    if(role==='rotate')change(turnStair(active,ctx.building,travelBearing(active)+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*(e.shiftKey?15:5)));
    else{
      const start=stairAnchors(active,ctx.building)[0],step=unitFactor(ctx.units)*(e.shiftKey?1:.1);
      const [dx,dy]=({ArrowRight:[step,0],ArrowLeft:[-step,0],ArrowUp:[0,step],ArrowDown:[0,-step]})[e.key];
      change(anchorStair(active,ctx.building,[start[0]+dx,start[1]+dy]));
    }
  }
  function clear(){for(const m of markers)m.remove();markers=[];}
  function sync(){
    if(!active){clear();return;}
    if(!markers.length)markers=roles.map(role=>{
      const el=document.createElement('button');el.type='button';el.className='stair-map-handle stair-'+role;
      const label=role==='move'?'Move stair start':'Rotate stairs around start';el.setAttribute('aria-label',label);el.title=label+' · drag or use arrow keys';
      el.textContent=role==='move'?'✥':'↻';const tag=document.createElement('span');tag.textContent=role==='move'?'Start':'Turn';el.append(tag);
      for(const type of ['click','dblclick','mousedown','mouseup','touchstart','touchend'])el.addEventListener(type,e=>e.stopPropagation());
      el.addEventListener('pointerdown',e=>down(e,role));el.addEventListener('keydown',e=>key(e,role));
      return new Marker({element:el,subpixelPositioning:true}).setLngLat(toLngLat([active.x,active.y],ctx.plan.origin)).addTo(map);
    });
  }
  return {
    install(){
      map.addSource('stair-preview',{type:'geojson',data:fc([])});
      map.addLayer({id:'stair-preview-fill',type:'fill',source:'stair-preview',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['case',['get','bad'],'#ff896c',['==',['get','part'],'start'],'#76eee1',['==',['get','part'],'arrival'],'#ffca75','#38999b'],'fill-opacity':.82}});
      map.addLayer({id:'stair-preview-lines',type:'line',source:'stair-preview',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['case',['get','bad'],'#ffb598',['==',['get','part'],'direction'],'#ffd485','#d6fffa'],'line-width':['case',['==',['get','part'],'tread'],1,2]}});
      map.on('move',refresh);
    },
    update(next){
      let item=next.item;
      try{if(item)validateStair({...item,name:item.name || 'Stair'},next.building);}catch{item=null;}
      if(drag && (!item || item.id!==active?.id || next.floor!==ctx.floor || next.building?.id!==ctx.building?.id))cancel();
      ctx=next;active=item;sync();render();
    },
    rects(){return markers.flatMap(m=>[m.getElement(),m.getElement().lastChild].map(el=>el.getBoundingClientRect()));},
    destroy(){cancel();clear();map.off('move',refresh);}
  };
}
