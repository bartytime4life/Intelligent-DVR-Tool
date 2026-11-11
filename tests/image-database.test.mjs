import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageDatabase, STORES} from '../src/image-database.mjs';

const flush = async () => {for (let i=0;i<5;i++) await Promise.resolve();};
function fixture() {
  let clock = 0, nextTimer = 0;
  const scheduled = new Map(), requests = [];
  const timers = {
    setTimeout(fn,ms) {const id = ++nextTimer; scheduled.set(id,{at:clock+ms,fn}); return id;},
    clearTimeout(id) {scheduled.delete(id);},
  };
  const factory = {open(name,version) {
    assert.equal(name,'intelligent-dvr'); assert.equal(version,1);
    const request = {}; requests.push(request); return request;
  }};
  const transact = createImageDatabase({getIndexedDB:() => factory,timeoutMs:20,now:() => clock,timers});
  function db() {
    const database = {closes:0,transactions:[],created:[],objectStoreNames:{contains:() => false},
      createObjectStore(name) {this.created.push(name);},
      close() {this.closes++;},
      transaction(store,mode) {
        const tx = {store,mode,aborts:0,committed:false,
          objectStore:() => ({put:() => {}}),
          abort() {this.aborts++; if (this.committed) throw Error('Already committed'); this.onabort?.();},
          complete() {this.committed = true; this.oncomplete();},
        };
        this.transactions.push(tx); return tx;
      },
    };
    return database;
  }
  async function opened(database = db()) {requests.at(-1).result = database; requests.at(-1).onsuccess(); await flush(); return database;}
  function advance(ms) {
    clock += ms;
    for (const [id,item] of [...scheduled]) if (item.at <= clock) {scheduled.delete(id); item.fn();}
  }
  return {transact,requests,db,opened,advance,scheduled};
}

test('image reads and writes share an open connection and resolve only at commit', async () => {
  const f = fixture(); let finished = false;
  const first = f.transact('thumbnails','readwrite',(_,done) => done('saved')).then(value => {finished = true; return value;});
  const db = await f.opened();
  assert.equal(finished,false); db.transactions[0].complete(); assert.equal(await first,'saved');
  const second = f.transact('zone-stills','readonly',(_,done) => done('read'));
  await flush(); db.transactions[1].complete(); assert.equal(await second,'read');
  assert.equal(f.requests.length,1); assert.equal(f.scheduled.size,0);
});

test('a stalled open fails on deadline without accumulating uncancellable requests', async () => {
  const f = fixture(), pending = f.transact('thumbnails','readwrite',() => {});
  const failed = assert.rejects(pending,/in time/); f.advance(20); await failed;
  for (let i=0;i<1000;i++) await assert.rejects(f.transact('thumbnails','readwrite',() => {}),/in time/);
  assert.equal(f.requests.length,1);
  const late = await f.opened(); assert.equal(late.closes,1); assert.equal(late.transactions.length,0);
  const retry = f.transact('thumbnails','readwrite',() => {}), recovered = await f.opened();
  recovered.transactions[0].complete(); await retry;
  assert.equal(f.requests.length,2); assert.equal(f.scheduled.size,0);
});

test('blocked opens fail promptly, close late handles and do not block future recovery', async () => {
  const f = fixture(), pending = f.transact('zone-stills','readwrite',() => {});
  const failed = assert.rejects(pending,/another tab/); f.requests[0].onblocked(); await failed;
  await assert.rejects(f.transact('thumbnails','readonly',() => {}),/another tab/);
  assert.equal(f.requests.length,1);
  const late = await f.opened(); assert.equal(late.closes,1);
  const retry = f.transact('zone-stills','readwrite',() => {}), recovered = await f.opened();
  recovered.transactions[0].complete(); await retry;
  assert.equal(f.scheduled.size,0);
});

test('an abandoned open cannot create its schema after the deadline', async () => {
  const f = fixture(), pending = f.transact('zone-stills','readonly',() => {});
  const failed = assert.rejects(pending,/in time/); f.advance(20); await failed;
  const db = f.db(), request = f.requests[0]; let aborted = 0;
  request.result = db; request.transaction = {abort:() => {aborted++;}};
  request.onupgradeneeded(); assert.equal(aborted,1); assert.deepEqual(db.created,[]);
  request.onerror();
  const retry = f.transact('thumbnails','readonly',() => {}), next = f.requests[1];
  next.result = db; next.onupgradeneeded(); assert.deepEqual(db.created,STORES);
  await f.opened(db); db.transactions[0].complete(); await retry;
});

test('transaction deadlines abort work and ignore a late completion, even after commit', async () => {
  for (const committed of [false,true]) {
    const f = fixture(), pending = f.transact('thumbnails','readwrite',() => {});
    const failed = assert.rejects(pending,/in time/), db = await f.opened();
    const tx = db.transactions[0]; tx.committed = committed;
    f.advance(20); await failed;
    assert.equal(tx.aborts,1); tx.oncomplete(); // Must not turn failure into success.
    const retry = f.transact('thumbnails','readwrite',() => {});
    await flush(); db.transactions[1].complete(); await retry;
    assert.equal(f.scheduled.size,0);
  }
});

test('opening and transaction work share one operation deadline', async () => {
  const f = fixture(), pending = f.transact('thumbnails','readwrite',() => {});
  const failed = assert.rejects(pending,/in time/);
  f.advance(15); const db = await f.opened(); f.advance(5); await failed;
  assert.equal(db.transactions[0].aborts,1);
});

test('version changes and forced connection closure release cached handles for retry', async () => {
  for (const event of ['onversionchange','onclose']) {
    const f = fixture(), first = f.transact('thumbnails','readonly',() => {}), db = await f.opened();
    db.transactions[0].complete(); await first;
    db[event](); if (event === 'onversionchange') assert.equal(db.closes,1);
    const retry = f.transact('zone-stills','readonly',() => {}), recovered = await f.opened();
    recovered.transactions[0].complete(); await retry; assert.equal(f.requests.length,2);
  }
});

test('open, transaction and work failures release operation state for another explicit attempt', async () => {
  const f = fixture(), first = f.transact('thumbnails','readonly',() => {});
  const failedOpen = assert.rejects(first,/could not open/); f.requests[0].onerror(); await failedOpen;
  const failingWork = f.transact('thumbnails','readwrite',() => {throw Error('Generated work failure');});
  const failedWork = assert.rejects(failingWork,/work failure/), db = await f.opened(); await failedWork;
  assert.equal(db.transactions[0].aborts,1);
  db.transaction = () => {throw Error('Connection closed');};
  await assert.rejects(f.transact('zone-stills','readonly',() => {}),/Connection closed/);
  assert.equal(db.closes,1);
  const retry = f.transact('zone-stills','readonly',() => {}), recovered = await f.opened();
  recovered.transactions[0].complete(); await retry;
});
