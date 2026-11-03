import test from 'node:test';
import assert from 'node:assert/strict';
import {LOCATION_WAIT_MS, requestSiteLocation} from '../src/facility-location.mjs';

function fixture() {
  const updates = [], errors = [], positions = [], cleared = [];
  let receive;
  const stop = requestSiteLocation({
    watchPosition(success) { receive = success; return 0; },
    clearWatch(id) { cleared.push(id); },
  }, {progress: m=>updates.push(m), failed: m=>errors.push(m), found: (...p)=>positions.push(p)});
  const fix = (accuracy, timestamp=Date.now()) => receive({coords:{longitude:-95.678,latitude:39.0483,accuracy}, timestamp});
  return {stop, fix, updates, errors, positions, cleared};
}

test('location search has a wall-clock deadline and drops late callbacks', t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();
  f.fix(80000); f.fix(1500); f.fix(2000);
  assert.equal(f.updates.length,2);
  t.mock.timers.tick(LOCATION_WAIT_MS);
  assert.match(f.errors[0],/1.5 km/);
  f.fix(1);
  assert.deepEqual(f.positions,[]);
  assert.deepEqual(f.cleared,[0]);
});

test('unknown accuracy and stale readings never replace site coordinates', ()=>{
  const f=fixture();
  f.fix(null); f.fix(0); f.fix(15,Date.now()-60000);
  assert.deepEqual(f.positions,[]);
  f.fix(100);
  assert.deepEqual(f.positions,[[[-95.678,39.0483],'100 m']]);
  f.stop();
  assert.deepEqual(f.cleared,[0]);
});

test('cancelling a pending request releases the watch and suppresses late readings', t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();
  f.stop(); f.fix(1);
  t.mock.timers.tick(LOCATION_WAIT_MS);
  assert.deepEqual(f.cleared,[0]);
  assert.deepEqual(f.errors,[]);
  assert.deepEqual(f.positions,[]);
});
