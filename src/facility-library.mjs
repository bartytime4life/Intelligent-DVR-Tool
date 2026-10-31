import {blankFacility, validateFacility, LIMITS} from './facility.mjs';

export const LIBRARY_KEY = 'dvr.facilities.v1';
export const LEGACY_KEY = 'dvr.facility.v1';
export const LIBRARY_SCHEMA = 'intelligent-dvr.facilities.v1';
export const MAX_FACILITIES = 30;
export const MAX_LIBRARY_BYTES = 4_000_000;
export const MAX_FACILITY_BYTES = LIMITS.bytes;

const bytes = text => new TextEncoder().encode(text).length;
const idOK = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const recordObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const now = () => new Date().toISOString();

function fail(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function boundedJSON(value, limit, message) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || bytes(text) > limit) throw Error(message);
  return text;
}

function cleanPlan(plan) {
  boundedJSON(plan, MAX_FACILITY_BYTES, 'Each facility must be 2 MB or smaller.');
  return validateFacility(plan);
}

function record(plan, existingIds = []) {
  const ids = new Set(existingIds);
  let id;
  do { id = 'facility-' + crypto.randomUUID(); } while (ids.has(id));
  return {id, updatedAt: now(), plan: cleanPlan(plan)};
}

// Validation returns independent copies and intentionally discards unknown fields.
export function validateLibrary(value) {
  boundedJSON(value, MAX_LIBRARY_BYTES, 'The facility collection must be 4 MB or smaller.');
  if (!recordObject(value) || value.schema !== LIBRARY_SCHEMA ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Array.isArray(value.facilities) || !value.facilities.length || value.facilities.length > MAX_FACILITIES)
    throw Error('Use a valid facility collection with 1–30 facilities and a valid revision.');
  const ids = new Set();
  const facilities = value.facilities.map(item => {
    if (!recordObject(item) || !idOK(item.id) || ids.has(item.id))
      throw Error('Every saved facility needs a unique valid ID.');
    ids.add(item.id);
    if (typeof item.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.updatedAt) ||
        !Number.isFinite(Date.parse(item.updatedAt)) || new Date(item.updatedAt).toISOString() !== item.updatedAt)
      throw Error('Saved facilities need valid UTC update timestamps.');
    return {id:item.id, updatedAt:item.updatedAt, plan:cleanPlan(item.plan)};
  });
  if (!idOK(value.activeId) || !ids.has(value.activeId)) throw Error('Choose an existing active facility.');
  return {schema:LIBRARY_SCHEMA, revision:value.revision, activeId:value.activeId, facilities};
}

export function createLibrary(plan = blankFacility()) {
  const item = record(plan);
  return validateLibrary({schema:LIBRARY_SCHEMA, revision:0, activeId:item.id, facilities:[item]});
}

// Reading never writes or deletes either key. Even a bad legacy save is preserved.
export function loadLibrary(storage) {
  let expectedRaw = null, recoveryRaw = null;
  try {
    expectedRaw = storage.getItem(LIBRARY_KEY);
    if (typeof expectedRaw === 'string') recoveryRaw = expectedRaw;
    if (expectedRaw !== null) {
      if (typeof expectedRaw !== 'string' || bytes(expectedRaw) > MAX_LIBRARY_BYTES)
        throw Error('The saved facility collection exceeds its 4 MB limit.');
      return {library:validateLibrary(JSON.parse(expectedRaw)), error:'', blocked:false, expectedRaw, migrated:false};
    }
    const legacy = storage.getItem(LEGACY_KEY);
    if (typeof legacy === 'string') recoveryRaw = legacy;
    if (legacy !== null) {
      if (typeof legacy !== 'string' || bytes(legacy) > MAX_FACILITY_BYTES)
        throw Error('The existing facility save exceeds its 2 MB limit.');
      return {library:createLibrary(cleanPlan(JSON.parse(legacy))), error:'', blocked:false, expectedRaw:null, migrated:true};
    }
    return {library:createLibrary(), error:'', blocked:false, expectedRaw:null, migrated:false};
  } catch (error) {
    return {
      library:createLibrary(), blocked:true, expectedRaw, migrated:false, recoveryRaw,
      error:'Existing facility saves could not be read. They have not been changed. Export any new work before reloading. ' + (error?.message || 'Browser storage is unavailable.'),
    };
  }
}

// A single setItem writes the complete envelope or fails without a partial save.
// The raw comparison prevents overwriting changes already visible from another tab;
// localStorage itself does not provide a transactional compare-and-swap operation.
export function persistLibrary(storage, library, expectedRaw) {
  if (expectedRaw !== null && typeof expectedRaw !== 'string') throw Error('A known saved revision is required before saving.');
  const clean = validateLibrary(library);
  if (clean.revision === Number.MAX_SAFE_INTEGER) throw Error('The saved revision limit was reached. Export a backup before continuing.');
  const next = {...clean, revision:clean.revision + 1};
  const raw = boundedJSON(next, MAX_LIBRARY_BYTES, 'The facility collection must be 4 MB or smaller.');
  let current;
  try { current = storage.getItem(LIBRARY_KEY); }
  catch { throw fail('Browser storage cannot be read. Your changes are in memory; export a backup before closing.', 'FACILITY_STORAGE'); }
  if (current !== expectedRaw)
    throw fail('Saved facilities changed in another tab. Export your current work before reloading to open the latest save.', 'FACILITY_CONFLICT');
  try { storage.setItem(LIBRARY_KEY, raw); }
  catch (error) {
    const quota = error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
    throw fail(quota ? 'Browser storage is full. Your changes are in memory; export a backup before closing.' :
      'Browser storage could not save these facilities. Your changes are in memory; export a backup before closing.',
    quota ? 'FACILITY_QUOTA' : 'FACILITY_STORAGE');
  }
  return {library:next, raw};
}

function uniqueName(facilities, requested) {
  const used = new Set(facilities.map(item => item.plan.name));
  const stem = requested.slice(0,100);
  if (!used.has(stem)) return stem;
  for (let i = 2; i <= MAX_FACILITIES + 1; i++) {
    const suffix = ' ' + i, name = stem.slice(0,100 - suffix.length) + suffix;
    if (!used.has(name)) return name;
  }
  return stem;
}

// Examples and imports get a distinct name so identical copies stay distinguishable.
export function addFacility(library, plan, {rename = false} = {}) {
  const clean = validateLibrary(library);
  if (clean.facilities.length >= MAX_FACILITIES) throw Error('This browser collection already has 30 facilities. Export a backup or remove a facility before adding another.');
  const supplied = plan ? rename && typeof plan.name === 'string' ? {...plan, name:uniqueName(clean.facilities, plan.name)} : plan :
    {...blankFacility(), name:uniqueName(clean.facilities, 'My facility')};
  const item = record(supplied, clean.facilities.map(item => item.id));
  return validateLibrary({...clean, activeId:item.id, facilities:[...clean.facilities,item]});
}

export function replaceActive(library, plan) {
  const clean = validateLibrary(library), nextPlan = cleanPlan(plan);
  return validateLibrary({...clean, facilities:clean.facilities.map(item => item.id === clean.activeId ? {...item, updatedAt:now(), plan:nextPlan} : item)});
}

export function selectFacility(library, id) {
  const clean = validateLibrary(library);
  if (!clean.facilities.some(item => item.id === id)) throw Error('Choose an existing saved facility.');
  return {...clean, activeId:id};
}

// The collection always keeps one facility; removing the active one opens its neighbour.
export function removeFacility(library, id) {
  const clean = validateLibrary(library), index = clean.facilities.findIndex(item => item.id === id);
  if (index < 0) throw Error('Choose an existing saved facility.');
  if (clean.facilities.length === 1) throw Error('Keep at least one facility. Create or import another before removing this one.');
  const facilities = clean.facilities.filter(item => item.id !== id);
  const activeId = clean.activeId === id ? facilities[Math.min(index, facilities.length - 1)].id : clean.activeId;
  return validateLibrary({...clean, activeId, facilities});
}

export function duplicateActive(library) {
  const clean = validateLibrary(library), current = clean.facilities.find(item => item.id === clean.activeId);
  const name = uniqueName(clean.facilities, current.plan.name.slice(0,95) + ' copy');
  return addFacility(clean, {...current.plan,name});
}

// Build the entire import before saving. Only the untouched automatic starter
// can yield its slot when a complete 30-facility backup needs every slot.
export function importFacilities(library, plans) {
  const clean = validateLibrary(library);
  if (!Array.isArray(plans) || !plans.length || plans.length > MAX_FACILITIES)
    throw Error('Import between 1 and 30 valid facilities.');
  const imported = plans.map(cleanPlan);
  const untouchedStarter = clean.facilities.length === 1 && clean.revision <= 1 &&
    JSON.stringify(clean.facilities[0].plan) === JSON.stringify(cleanPlan(blankFacility()));
  const needsStarterSlot = clean.facilities.length + imported.length > MAX_FACILITIES;
  let next = clean, remaining = imported;
  if (needsStarterSlot && untouchedStarter) {
    next = {...createLibrary(imported[0]), revision:clean.revision};
    remaining = imported.slice(1);
  }
  for (const plan of remaining) next = addFacility(next, plan, {rename:true});
  return next;
}

export function facilityFilename(plan) {
  const name = typeof plan?.name === 'string' ? plan.name : 'facility';
  const safe = name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64).replace(/-+$/g,'') || 'facility';
  return 'dvr-' + safe + '.json';
}

// Import validates the entire file before returning any plans. The caller adds
// these with fresh collection IDs, so opening a backup cannot overwrite a site.
export function parseFacilityFile(text) {
  if (typeof text !== 'string' || bytes(text) > MAX_LIBRARY_BYTES) throw Error('Facility files must be 4 MB or smaller.');
  const value = JSON.parse(text);
  if (value?.schema === LIBRARY_SCHEMA) return validateLibrary(value).facilities.map(item => item.plan);
  if (bytes(text) > MAX_FACILITY_BYTES) throw Error('Individual facility files must be 2 MB or smaller.');
  return [cleanPlan(value)];
}
