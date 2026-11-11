import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_OBSERVATIONS} from '../src/live-ai.mjs';
import {MAX_LIVE_REVIEW_SESSIONS, pendingLiveCount, pendingLiveReviews, canStartLiveReview,
  pruneLiveReviews, retainedLiveTiles} from '../src/live-review.mjs';

const pending = () => ({state:'stopped',cameraName:'Generated DVR',observations:[{sent:false,still:new Blob(['generated'])}]});

test('disconnected observations remain reviewable without becoming a camera preview', () => {
  const state = pending(), states = {old:state};
  assert.equal(pruneLiveReviews(states, []), states);
  assert.deepEqual(retainedLiveTiles(states, []), [{id:'old',name:'Generated DVR',kind:'retained',state:'stopped',reviewOnly:true}]);
  assert.deepEqual(retainedLiveTiles(states, ['old']), []);
  assert.equal(pendingLiveCount(state),1);
});

test('sent or dismissed disconnected snapshots release their still references', () => {
  const sent = {state:'stopped',observations:[{sent:true,still:new Blob(['sent'])}]};
  const dismissed = {state:'failed',observations:[]};
  assert.deepEqual(pruneLiveReviews({sent,dismissed}, []), {});
  assert.deepEqual(retainedLiveTiles({sent,dismissed}, []), []);
  // Keep errors and controls for a source that is still on the wall.
  assert.deepEqual(pruneLiveReviews({sent,dismissed}, ['dismissed']), {dismissed});
});

test('starting and live AI reserve review capacity before their first observation', () => {
  const states = {a:{state:'starting'},b:{state:'live'},c:pending(),d:pending()};
  assert.equal(canStartLiveReview(states,'another'),false);
  assert.equal(canStartLiveReview(states,'a'),true);
  assert.equal(canStartLiveReview(states,'c'),true);
  assert.equal(pendingLiveReviews(states),2);
  // A visible stopped source with no pending stills cannot bypass admission.
  states.empty = {state:'stopped',observations:[]};
  assert.equal(canStartLiveReview(states,'empty'),false);
  states.a = {state:'failed',observations:[]};
  assert.equal(canStartLiveReview(states,'another'),true);
});

test('four review snapshots bound retained observations to eighty', () => {
  let states = {};
  for (let index=0; index<MAX_LIVE_REVIEW_SESSIONS; index++) {
    const id = String(index);
    assert.equal(canStartLiveReview(states,id),true);
    states[id] = {state:'stopped',observations:Array.from({length:LIVE_OBSERVATIONS}, () => ({sent:false}))};
  }
  assert.equal(pendingLiveReviews(states),80);
  assert.equal(canStartLiveReview(states,'fifth'),false);
  states[0].observations = states[0].observations.map(item => ({...item,sent:true}));
  states = pruneLiveReviews(states, []);
  assert.equal(pendingLiveReviews(states),60);
  assert.equal(canStartLiveReview(states,'fifth'),true);
});

test('repeated empty terminal sources do not accumulate invisible snapshots', () => {
  let states = {kept:pending()};
  for (let index=0; index<1000; index++) {
    const id = `source-${index}`;
    states = {...states,[id]:{state:'failed',observations:[]}};
    states = pruneLiveReviews(states, []);
    assert.deepEqual(Object.keys(states),['kept']);
  }
});

test('active reservations survive source removal until Stop releases them', () => {
  const state = {state:'starting',observations:[]}, states = {starting:state};
  assert.equal(pruneLiveReviews(states, []), states);
  assert.deepEqual(retainedLiveTiles(states, []), []);
  assert.deepEqual(pruneLiveReviews({starting:{...state,state:'stopped'}}, []), {});
});
