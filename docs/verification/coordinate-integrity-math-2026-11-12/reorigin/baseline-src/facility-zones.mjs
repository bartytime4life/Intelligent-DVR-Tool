// Explicit model classes used by the bundled COCO80 profile. Custom models need matching rules.
export const FACILITY_CLASSES = Object.freeze(["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"]);
export const ZONE_TYPES = Object.freeze(['restricted', 'object_watch']);

export function createFacilityZone(footprint, options = {}) {
  return {id: 'z-' + crypto.randomUUID().slice(0, 8), name: 'Restricted area',
    type: 'restricted', footprint: footprint.map(p => p.map(v => Math.round(v * 100) / 100)),
    enabled: true, expectedClasses: ['person'], dwellSeconds: 2, ...options};
}

export function validateImageRegion(region, cameras) {
  if (!region || typeof region !== 'object' || Array.isArray(region) ||
      !cameras.some(c => c.id === region.cameraId) ||
      !Array.isArray(region.rect) || region.rect.length !== 4 ||
      !region.rect.every(v => typeof v === 'number' && Number.isFinite(v)) ||
      !Number.isFinite(region.threshold) || region.threshold < .1 || region.threshold > 1 ||
      !Number.isFinite(region.maxGap) || region.maxGap <= 0 || region.maxGap > 60)
    throw Error('Choose an existing camera, a valid image rectangle, confidence 0.1–1 and gap over 0–60 seconds.');
  const [x,y,w,h] = region.rect;
  if (Math.min(x,y) < 0 || Math.min(w,h) <= 0 || x+w > 1 || y+h > 1)
    throw Error('The image rectangle must stay inside the frame.');
  return {cameraId:region.cameraId, rect:[...region.rect], threshold:region.threshold, maxGap:region.maxGap};
}

// Intentionally no map-to-image projection: the operator draws/measures this region in the matching camera image.
export function compileZoneRules(zone, cameras) {
  if (!zone?.enabled) throw Error('Enable the zone before exporting its detection rules.');
  if (!ZONE_TYPES.includes(zone.type) || typeof zone.name !== 'string' || !zone.name.trim() ||
      !Number.isFinite(zone.dwellSeconds) || zone.dwellSeconds < 0 || zone.dwellSeconds > 3600 ||
      !Array.isArray(zone.expectedClasses) || zone.expectedClasses.length > FACILITY_CLASSES.length ||
      zone.expectedClasses.some(c => !FACILITY_CLASSES.includes(c)) ||
      new Set(zone.expectedClasses).size !== zone.expectedClasses.length)
    throw Error('Save a valid zone before exporting detection rules.');
  const region = validateImageRegion(zone.imageRegion, cameras);
  const labels = zone.type === 'restricted' ? ['person'] : FACILITY_CLASSES.filter(label => !zone.expectedClasses.includes(label));
  if (!labels.length) throw Error('All model classes are marked expected. Select at least one class to flag.');
  return labels.map((label,index) => ({name:`${zone.name.slice(0,25)} · ${label.slice(0,25)} #${index+1}`,
    label, rect:[...region.rect], dwell:zone.dwellSeconds, threshold:region.threshold, max_gap:region.maxGap}));
}
