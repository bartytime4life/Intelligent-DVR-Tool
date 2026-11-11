import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLiveSession, parseLiveFrame, LIVE_REPLY_ERROR} from '../src/live-reply.mjs';

const session = () => ({id:'a'.repeat(32),state:'live',camera:'Generated view',model:'Generated detector',rules:'Generated rules',
  model_id:'model',rules_id:'rules',model_sha256:'b'.repeat(64),analyzed:1,skipped_still:0,
  runtime:{backend_id:'opencv-cpu'},acceleration:{code:'CPU_DEFAULT'},tracks_by_label:{person:1}});
const detection = () => ({label:'person',score:.9,box:[.1,.1,.2,.5],track:1});
const observation = () => ({id:'c'.repeat(32),camera:'Generated view',label:'person',score:.9,seconds:1,
  started_seconds:0,rule:'Generated presence rule',review_required:true});
const frame = () => ({width:960,height:540,detector:'ran',session:session(),detections:[detection()],observations:[observation()],
  timing:{inference_ms:4,total_ms:6}});
const invalid = work => assert.throws(work, error => error.code === 'LIVE_REPLY_INVALID' && error.message === LIVE_REPLY_ERROR);

test('live replies keep independent displayed evidence and discard unused payload fields', () => {
  const reply = frame(); reply.unused = {pixels:'never retained'}; reply.session.unused = reply.unused;
  const parsed = parseLiveFrame(reply,session());
  assert.equal(parsed.session.camera,'Generated view');
  assert.equal(parsed.unused,undefined); assert.equal(parsed.session.unused,undefined);
  reply.detections[0].box[0] = .9; reply.session.tracks_by_label.person = 100;
  reply.observations[0].label = 'changed'; reply.timing.inference_ms = 999;
  assert.deepEqual(parsed.detections[0].box,[.1,.1,.2,.5]);
  assert.equal(parsed.session.tracks_by_label.person,1);
  assert.equal(parsed.observations[0].label,'person'); assert.equal(parsed.timing.inference_ms,4);
});

test('live session metadata is valid before it reaches the tile', () => {
  for (const change of [
    v => {v.id = '../other';}, v => {v.state = 'starting';}, v => {v.model_sha256 = '';},
    v => {v.camera = null;}, v => {v.model = {name:'bad'};}, v => {v.rules = [];},
    v => {v.analyzed = -1;}, v => {v.skipped_still = .5;},
    v => {v.tracks_by_label = [];}, v => {v.tracks_by_label.person = {};},
    v => {v.runtime = {backend_id:'invented'};}, v => {v.acceleration = {code:{}};},
    v => {v.model_id = 'invalid/path';},
  ]) {const value = session(); change(value); invalid(() => parseLiveSession(value));}
  for (const value of [null,[],{},'session']) invalid(() => parseLiveSession(value));
});

test('start choices and frame provenance remain bound to the accepted camera and run', () => {
  const current = session();
  for (const key of ['id','camera','model','rules','model_sha256','model_id','rules_id']) {
    const reply = session(); reply[key] = key === 'id' ? 'd'.repeat(32) : key === 'model_sha256' ? 'e'.repeat(64) : 'another';
    invalid(() => parseLiveSession(reply,current));
  }
  const missing = session(); delete missing.rules_id;
  invalid(() => parseLiveFrame({...frame(),session:missing},current));
  invalid(() => parseLiveSession(session(),{camera:'Other view',model_id:'model',rules_id:'rules'}));
  // Older service replies can omit model/rule IDs, but cannot change them after
  // the start reply has supplied them. Core camera/run/hash binding is mandatory.
  const older = session(); delete older.model_id; delete older.rules_id;
  assert.equal(parseLiveSession(older,{model_id:'model',rules_id:'rules'}).id,older.id);
});

test('malformed or oversized live frames cannot become rendered detections', () => {
  const changes = [
    v => {v.width = 0;}, v => {v.height = 15;}, v => {v.width = 1921; v.height = 1080;},
    v => {v.width = 960.5;}, v => {v.detector = 'unknown';},
    v => {v.detections = {};}, v => {v.detections = Array.from({length:101},detection);},
    v => {v.detections[0] = null;}, v => {v.detections[0].score = '.9';},
    v => {v.detections[0].score = Infinity;}, v => {v.detections[0].score = 1.1;},
    v => {v.detections[0].label = {};}, v => {v.detections[0].box = [.1,.2,.3];},
    v => {v.detections[0].box[0] = NaN;}, v => {v.detections[0].box[2] = 0;},
    v => {v.detections[0].box = [.9,.1,.2,.5];}, v => {v.detections[0].track = 0;},
    v => {v.timing = '5 ms';}, v => {v.timing.total_ms = null;}, v => {v.timing.inference_ms = {};},
  ];
  for (const change of changes) {const value = frame(); change(value); invalid(() => parseLiveFrame(value,session()));}
  for (const value of [null,[],{}]) invalid(() => parseLiveFrame(value,session()));
  for (const expected of [undefined,null,{}]) invalid(() => parseLiveFrame(frame(),expected));
});

test('invalid observations reject the whole reply before review or still handoff', () => {
  for (const change of [
    v => {v.observations = {};}, v => {v.observations = Array.from({length:101},observation);},
    v => {v.observations[0] = null;}, v => {v.observations[0].score = {};},
    v => {v.observations[0].id = 'bad';}, v => {v.observations.push({...v.observations[0]});},
    v => {v.observations[0].label = [];}, v => {v.observations[0].seconds = -1;},
    v => {v.observations[0].rule = {name:'bad'};}, v => {v.observations[0].camera = 'Other view';},
    v => {v.observations[0].started_seconds = 2;}, v => {v.observations[0].review_required = false;},
  ]) {const value = frame(); change(value); invalid(() => parseLiveFrame(value,session()));}
});

test('valid boundary rounding, idle timing and worker collection limits remain accepted', () => {
  const edge = frame(); edge.width = 1920; edge.height = 1080;
  edge.detections = Array.from({length:100}, () => ({label:'person',score:1,box:[.33333,0,.66668,1]}));
  edge.observations = Array.from({length:100}, (_,i) => ({...observation(),id:i.toString(16).padStart(32,'0')}));
  edge.observations[0].started_seconds = 1.00000049;
  assert.equal(parseLiveFrame(edge,session()).observations.length,100);
  const idle = frame(); idle.detector = 'skipped-still'; idle.detections = []; idle.observations = [];
  idle.timing.inference_ms = null;
  assert.equal(parseLiveFrame(idle,session()).timing.inference_ms,null);
  idle.observations = [observation()]; invalid(() => parseLiveFrame(idle,session()));
  const unicode = session(); unicode.camera = '📷'.repeat(80); unicode.model = '📷'.repeat(80);
  assert.equal(parseLiveSession(unicode).camera,unicode.camera);
});
