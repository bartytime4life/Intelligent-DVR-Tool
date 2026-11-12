import {ShapeUtils, Vector2} from 'three';
import {toLngLat} from './facility.mjs';

// A component keeps its outer ring and holes together throughout rendering.
export function visibilityCollection(cameras, geometryOf, origin, selected, suppressedId) {
  return {type:'FeatureCollection',features:cameras.flatMap(camera=>{
    const result=camera.id===suppressedId ? null : geometryOf?.(camera);
    return camera.enabled && result?.estimated && result.polygons?.length ? [{
      type:'Feature',properties:{id:camera.id,selected:camera.id===selected},
      geometry:{type:'MultiPolygon',coordinates:result.polygons.map(polygon=>
        polygon.map(ring=>ring.map(point=>toLngLat(point,origin))))},
    }] : [];
  })};
}

// Triangulate each ground component with its holes. Side triangles follow every
// boundary independently; no artificial bridge joins components or caps a hole.
export function visibilityMesh(camera, polygons, elevation=.12) {
  const caps=[],sides=[],outlines=[];
  for(const polygon of polygons || []) {
    const rings=polygon.map(ring=>{
      const last=ring.at(-1),first=ring[0];
      return first && last && first[0]===last[0] && first[1]===last[1] ? ring.slice(0,-1) : ring.slice();
    });
    if(!rings[0] || rings[0].length<3) continue;
    const contour=rings[0].map(([x,y])=>new Vector2(x,y));
    const holes=rings.slice(1).filter(r=>r.length>=3).map(r=>r.map(([x,y])=>new Vector2(x,y)));
    const points=[contour,...holes].flat();
    for(const triangle of ShapeUtils.triangulateShape(contour,holes))
      for(const index of triangle) caps.push(points[index].x,points[index].y,elevation);
    for(const ring of rings) {
      if(ring.length<3) continue;
      outlines.push([...ring,ring[0]].map(([x,y])=>[x,y,elevation]));
      for(let i=0;i<ring.length;i++) {
        const a=ring[i],b=ring[(i+1)%ring.length];
        sides.push(camera.x,camera.y,camera.z,a[0],a[1],elevation,b[0],b[1],elevation);
      }
    }
  }
  return {caps,sides,outlines};
}
