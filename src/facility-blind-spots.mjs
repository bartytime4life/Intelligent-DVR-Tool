import {toLngLat} from './facility.mjs';

// Preserve each polygon's outer ring and holes together. An unavailable or
// cleared result removes the old overlay instead of leaving stale geometry.
export function blindSpotCollection(polygons, origin) {
  return {
    type: 'FeatureCollection',
    features: polygons?.length ? [{
      type: 'Feature', properties: {},
      geometry: {type: 'MultiPolygon', coordinates: polygons.map(polygon =>
        polygon.map(ring => ring.map(point => toLngLat(point, origin))))},
    }] : [],
  };
}
