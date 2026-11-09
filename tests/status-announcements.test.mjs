import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisAnnouncement, recorderAnnouncement, backupAnnouncement } from '../src/status-announcements.mjs';

test('analysis phase announcements stay unchanged as frame and time counters advance', () => {
  const job = {state:'running', phase:'analyzing', frames_read:5, frames_analyzed:1, elapsed_seconds:1};
  assert.equal(analysisAnnouncement(job), analysisAnnouncement({...job, frames_read:100, frames_analyzed:20, elapsed_seconds:10}));
  assert.notEqual(analysisAnnouncement(job), analysisAnnouncement({...job, phase:'verifying'}));
  assert.match(analysisAnnouncement({...job,state:'completed',result_state:'partial'}), /partial.*coverage/);
  assert.match(analysisAnnouncement({...job,state:'failed'}), /stopped.*error/);
  assert.match(analysisAnnouncement({...job,state:'cancelled'}), /cancelled.*preserved/);
  assert.match(analysisAnnouncement(job,false), /unavailable.*Reconnect/);
  assert.equal(analysisAnnouncement(null,false), '');
});

test('recording announcements distinguish loss, stopping and storage trouble without reading counters', () => {
  const status = {state:'recording',active:true,counters:{recorded:1},retry_seconds:0};
  assert.equal(recorderAnnouncement(status), recorderAnnouncement({...status,counters:{recorded:50},retry_seconds:2}));
  assert.match(recorderAnnouncement(status,false), /unknown.*still be running/);
  assert.match(recorderAnnouncement({...status,state:'stopping'}), /Wait for confirmed/);
  assert.match(recorderAnnouncement({...status,state:'disk_pressure'}), /storage attention/);
  assert.match(recorderAnnouncement({...status,state:'stopped',active:false}), /is stopped/);
  assert.equal(recorderAnnouncement(null), '');
});

test('backup state transitions announce attention and optional analysis independently of copy progress', () => {
  const status = {configured:true,active:true,analyzing:false,copying:{copied_bytes:1},storage_bytes:1};
  assert.equal(backupAnnouncement(status), backupAnnouncement({...status,copying:{copied_bytes:100},storage_bytes:100}));
  assert.notEqual(backupAnnouncement(status), backupAnnouncement({...status,analyzing:true}));
  assert.match(backupAnnouncement(status,false), /unknown.*may continue/);
  assert.match(backupAnnouncement({...status,error:'Retained invalid receipt'}), /attention.*preserved/);
  assert.match(backupAnnouncement({...status,active:false}), /paused/);
  assert.equal(backupAnnouncement(null), '');
});
