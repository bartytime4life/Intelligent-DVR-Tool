import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MAX_BYTE_RECEIPT_BYTES, parseByteReceipt, readByteReceipt, compareByteReceipts} from '../src/acceptance-receipts.mjs';
import {findWorkspaceTasks} from '../src/workspace-tasks.mjs';

const receipt = (extra={}) => ({schema:'intelligent-dvr.field-byte-check.v1',utc:'2026-11-09T00:00:00+00:00',
  check:'PASS',input_kind:'generated',operator_supplied_revision:'a'.repeat(40),verifier_sha256:'b'.repeat(64),
  field_acceptance:'NOT_ESTABLISHED',source_sha256:'c'.repeat(64),backup_sha256:'c'.repeat(64),bytes:100,
  independent_file:true,review_binding:'NOT_RUN',...extra});
const file = value => new File([JSON.stringify(value)],'generated-byte-check.json',{type:'application/json'});

test('normalizes only bounded byte-check evidence and fingerprints the exact file', async () => {
  const selected = file(receipt({private_path:'/do/not/store',document_sha256:'fake'}));
  const result = await readByteReceipt(selected);
  assert.equal(result.check,'PASS');
  assert.equal(result.documentHash,createHash('sha256').update(Buffer.from(await selected.arrayBuffer())).digest('hex'));
  assert.equal(result.private_path,undefined);
  assert.equal(result.document_sha256,undefined);
  assert.equal(result.backend,undefined);
  assert.equal(result.kind,'generated');
});
test('rejects oversize or changed-size files before interpretation', async () => {
  let read=false;
  await assert.rejects(readByteReceipt({size:MAX_BYTE_RECEIPT_BYTES+1,arrayBuffer(){read=true;}}),/1 MiB/);
  assert.equal(read,false);
  await assert.rejects(readByteReceipt({size:10,arrayBuffer:async()=>new Uint8Array(20).buffer}));
});
test('malformed JSON and invalid UTF-8 receive generic errors without echoed content', async () => {
  for (const selected of [new File(['private-name invalid JSON'],'a.json'),new File([new Uint8Array([255,254,255])],'b.json')]) {
    await assert.rejects(readByteReceipt(selected),error => !error.message.includes('private-name') && /UTF-8 JSON/.test(error.message));
  }
});
test('rejects recognition reviews, invented acceptance and invalid source correspondence', () => {
  for (const changed of [null,[],{schema:'intelligent-dvr.recognition-review.v1'},receipt({field_acceptance:'PASS'}),
    receipt({backup_sha256:'d'.repeat(64)}),receipt({independent_file:false}),receipt({source_sha256:'not a hash'}),
    receipt({bytes:0}),receipt({bytes:true}),receipt({bytes:64*1024**3+1}),receipt({bytes:1.5}),
    receipt({operator_supplied_revision:'/private/owner'}),receipt({utc:'November 9 2026 (private note)'}),
    receipt({review_binding:'MATCHED'}),receipt({reported_backend:'onnxruntime-cuda'}),receipt({previous_binding:'MATCHED'})]) {
    assert.throws(()=>parseByteReceipt(changed));
  }
});
test('failure receipts do not promote residual review or byte claims', () => {
  const failed=parseByteReceipt(receipt({check:'FAIL',error_code:'SOURCE_CHANGED_SINCE_PREVIOUS',review_binding:'MATCHED'}));
  assert.equal(failed.check,'FAIL');assert.equal(failed.review,'NOT_RUN');assert.equal(failed.source,undefined);
  assert.equal(parseByteReceipt(receipt({check:'FAIL',error_code:'/private/path'})).error,'CHECK_FAILED');
});
test('reported CPU, CUDA and partial coverage remain separate metadata fields', () => {
  for (const backend of ['opencv-cpu','onnxruntime-cuda']) {
    const value=parseByteReceipt(receipt({review_binding:'MATCHED',review_sha256:'d'.repeat(64),reported_backend:backend,reported_coverage:'partial'}));
    assert.equal(value.backend,backend);assert.equal(value.coverage,'partial');
    assert.equal(value.gpu_accepted,undefined);assert.equal(value.field_accepted,undefined);
  }
});
test('compares matching source bytes without claiming an earlier-receipt link', async () => {
  const earlier=await readByteReceipt(file(receipt())),current=await readByteReceipt(file(receipt({utc:'2026-11-09T01:00:00Z'})));
  assert.deepEqual(compareByteReceipts(earlier,current),{state:'MATCHED',title:'The receipts report the same source bytes.',linked:false});
  assert.equal(compareByteReceipts(null,current).state,'WAITING');
});
test('validates an optional earlier-receipt link against the actual selected file hash', async () => {
  const earlier=await readByteReceipt(file(receipt()));
  const current=await readByteReceipt(file(receipt({previous_binding:'MATCHED',previous_receipt_sha256:earlier.documentHash})));
  assert.equal(compareByteReceipts(earlier,current).linked,true);
  assert.equal(compareByteReceipts({...earlier,documentHash:'e'.repeat(64)},current).state,'INCOMPATIBLE');
});
test('rejects mismatched source, scope, revision, verifier, order and failed checks', async () => {
  const earlier=await readByteReceipt(file(receipt()));
  for (const [change,state] of [[{source_sha256:'d'.repeat(64),backup_sha256:'d'.repeat(64)},'DIFFERENT'],
    [{bytes:101},'DIFFERENT'],[{input_kind:'oem'},'INCOMPATIBLE'],[{operator_supplied_revision:'d'.repeat(40)},'INCOMPATIBLE'],
    [{verifier_sha256:'e'.repeat(64)},'INCOMPATIBLE'],[{utc:'2026-11-08T00:00:00Z'},'INCOMPATIBLE'],[{check:'FAIL'},'BLOCKED']]) {
    const current=await readByteReceipt(file(receipt(change)));
    assert.equal(compareByteReceipts(earlier,current).state,state);
  }
});
test('task search makes acceptance checks discoverable in the existing backup path', () => {
  for (const query of ['byte checksum','acceptance verification','backup receipts']) assert.equal(findWorkspaceTasks(query)[0].id,'backup');
});
