import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETUP, GiB, calculateSetup, parseSetup, validateSetup, resourcePolicy, visibleCameraSlots, sampleShouldRun, parseHostSnapshot } from '../src/resources.mjs';
const plan = () => structuredClone(DEFAULT_SETUP);
test('100 × 4 Mbit × 30 days distinguishes raw, redundancy, overhead and reserve', () => {
  const a = calculateSetup(plan());
  assert.equal(a.ingressMbps, 400);
  assert.ok(Math.abs(a.videoTBPerDay - 4.32) < 1e-12);
  assert.ok(Math.abs(a.neededTB - 142.56) < 1e-10);
  assert.equal(a.rawTB, 288); assert.equal(a.protectedTB, 240);
  assert.ok(Math.abs(a.recordingBudgetTB - 182.4) < 1e-10);
  assert.ok(Math.abs(a.retentionDays - 38.3838383838) < 1e-8);
  assert.ok(Math.abs(a.perDriveTBYear - 260.172) < 1e-8);
  assert.equal(a.startupW, 630); assert.equal(a.suggestedPsuW, 840);
});
test('doubling bitrate halves retention; six 24TB dual-parity drives are inadequate for this full workload', () => {
  const s = plan(), first = calculateSetup(s); s.workload.mbps = 8;
  assert.equal(calculateSetup(s).retentionDays, first.retentionDays / 2);
  s.storage.drives = 6;
  assert.ok(calculateSetup(s).warnings.some(x => x.includes('retention')));
});
test('mirror and unprotected capacity are explicit and invalid arrays cannot be saved', () => {
  const s = plan(); s.storage.layout = 'mirror'; s.storage.drives = 8;
  assert.equal(calculateSetup(s).protectedTB, 96);
  s.storage.drives = 7; assert.throws(() => validateSetup(s), /even/);
  s.storage.layout = 'dual-parity'; s.storage.drives = 3; assert.throws(() => validateSetup(s));
  s.storage.layout = 'unprotected'; assert.ok(calculateSetup(s).warnings.some(x => x.includes('redundancy')));
});
test('memory, byte-budget, drive-workload and power warnings never become capacity passes', () => {
  const s = plan(); s.compute.bufferMiB = 2; s.compute.workerMiB = 65536;
  s.power.gpuW = 575; s.storage.workloadRating = 100;
  const a = calculateSetup(s);
  for (const text of ['RAM', 'queue budget', 'annual workload', '75%']) assert.ok(a.warnings.some(x => x.includes(text)), text);
});
test('VRAM contexts include batch tensors and exceed the allowance without pretending to run GPU inference', () => {
  const s = plan(), a = calculateSetup(s);
  assert.ok(Math.abs(a.gpuEstimatedGiB - (2 * (512 + 2048 + 4 * 4.6875) / 1024)) < 1e-10);
  assert.equal(a.gpuAvailableGiB, 12);
  s.gpu.sessions = 8; assert.ok(calculateSetup(s).warnings.some(x => x.includes('VRAM')));
  s.gpu.reserveGiB = 16; assert.throws(() => validateSetup(s));
});
test('invalid imported values, prototype fields and unbounded JSON are rejected', () => {
  for (const change of [s => s.workload.cameras = true, s => s.workload.mbps = '', s => s.workload.mbps = Infinity,
    s => s.compute.threads = 9, s => s.compute.threadBudget = 1, s => s.compute.reserveGiB = 128,
    s => s.extra = 'no', s => s.gpu.profile = '__proto__']) {
    const s = plan(); change(s); assert.throws(() => validateSetup(s));
  }
  assert.throws(() => parseSetup(' '.repeat(65537)));
  assert.deepEqual(parseSetup(JSON.stringify(plan())), plan());
});
test('exported application policy matches the shared Python contract fixture', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/resource-policy.json', import.meta.url), 'utf8'));
  assert.deepEqual(resourcePolicy(plan()), expected);
  const s = plan(); s.platform = 'windows'; assert.equal(resourcePolicy(s).platform, 'windows');
  assert.equal(resourcePolicy(s).gpu, undefined);
});
test('wall budget always preserves selected sources with at most the applied count', () => {
  assert.deepEqual(visibleCameraSlots([1, 2, 3, 4], 5, 1), [5]);
  assert.deepEqual(visibleCameraSlots([1, 2, 3, 4], 4, 2), [4, 2]);
  assert.deepEqual(visibleCameraSlots([1, 2, 3, 4], 3, 4), [1, 2, 3, 4]);
});
test('background sample playback respects the applied pause setting', () => {
  assert.equal(sampleShouldRun(true, true, true), false);
  assert.equal(sampleShouldRun(true, false, true), true);
  assert.equal(sampleShouldRun(true, true, false), true);
  assert.equal(sampleShouldRun(false, false, false), false);
});
test('host import retains bounded numerical observations and drops private or unknown fields', () => {
  const s = { schema: 'intelligent-dvr.host-snapshot.v1', platform: 'windows', captured_at: '2026-10-27T18:00:00Z',
    cpu_logical: 32, ram_total_bytes: 128 * GiB, volumes: [{total_bytes: 1e12, free_bytes: 8e11, path:'private'}],
    gpus: [{ name: '<b>GPU</b>', memory_mib: 16384, serial:'secret' }], hostname: 'private' };
  const clean = parseHostSnapshot(JSON.stringify(s));
  assert.equal(clean.hostname, undefined); assert.equal(clean.volumes[0].path, undefined);
  assert.equal(clean.gpus[0].serial, undefined); assert.equal(clean.gpus[0].name, '<b>GPU</b>');
  s.volumes[0].free_bytes = 2e12; assert.throws(() => parseHostSnapshot(JSON.stringify(s)));
  s.volumes = []; s.ram_total_bytes = null; assert.equal(parseHostSnapshot(JSON.stringify(s)).ram_total_bytes, null);
});
