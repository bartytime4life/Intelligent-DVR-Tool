// Receipt interpretation only. No recording access, requests, persistence or inference.
export const MAX_BYTE_RECEIPT_BYTES = 1024 * 1024;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const valid = (condition, message = 'Choose an unmodified field byte-check receipt from the acceptance verifier.') => {
  if (!condition) throw Error(message);
};

export function parseByteReceipt(data) {
  valid(data && typeof data === 'object' && !Array.isArray(data));
  valid(data.schema === 'intelligent-dvr.field-byte-check.v1');
  valid(['PASS','FAIL'].includes(data.check) && ['generated','oem'].includes(data.input_kind));
  valid(data.field_acceptance === 'NOT_ESTABLISHED', 'This record claims field acceptance. It is not a supported byte-check receipt.');
  valid(typeof data.operator_supplied_revision === 'string' && /^[a-f0-9]{40}$/.test(data.operator_supplied_revision),
    'The receipt needs an exact 40-character app revision. Run the verifier again with the kit or Git commit.');
  valid(hash(data.verifier_sha256) && typeof data.utc === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(data.utc)
    && Number.isFinite(Date.parse(data.utc)));
  const result = {check:data.check, kind:data.input_kind, revision:data.operator_supplied_revision,
    verifier:data.verifier_sha256, utc:data.utc, error:'', review:'NOT_RUN', previous:'NOT_RUN'};
  if (data.check === 'FAIL') {
    result.error = typeof data.error_code === 'string' && /^[A-Z_]{1,80}$/.test(data.error_code) ? data.error_code : 'CHECK_FAILED';
    return result;
  }
  valid(data.independent_file === true && hash(data.source_sha256) && data.source_sha256 === data.backup_sha256);
  valid(Number.isSafeInteger(data.bytes) && data.bytes > 0 && data.bytes <= 64 * 1024 ** 3);
  valid(['NOT_RUN','MATCHED'].includes(data.review_binding));
  Object.assign(result, {source:data.source_sha256, bytes:data.bytes, review:data.review_binding});
  if (data.review_binding === 'MATCHED') {
    valid(hash(data.review_sha256) && ['opencv-cpu','onnxruntime-cuda'].includes(data.reported_backend)
      && ['completed','partial'].includes(data.reported_coverage));
    Object.assign(result, {backend:data.reported_backend, coverage:data.reported_coverage});
  } else valid(data.reported_backend === undefined && data.reported_coverage === undefined);
  valid(data.previous_binding === undefined || ['NOT_RUN','MATCHED'].includes(data.previous_binding));
  if (data.previous_binding === 'MATCHED') {
    valid(hash(data.previous_receipt_sha256));
    Object.assign(result, {previous:'MATCHED', previousHash:data.previous_receipt_sha256});
  }
  return result;
}

export async function readByteReceipt(file) {
  valid(file && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= MAX_BYTE_RECEIPT_BYTES,
    'Choose a JSON receipt no larger than 1 MiB. Video and recognition-review files are not needed here.');
  const bytes = await file.arrayBuffer();
  valid(bytes.byteLength === file.size && bytes.byteLength <= MAX_BYTE_RECEIPT_BYTES);
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw Error('The file is not readable UTF-8 JSON. Your previously loaded receipts are preserved.'); }
  const result = parseByteReceipt(data);
  valid(globalThis.crypto?.subtle, 'This browser cannot fingerprint receipts. Use the installed localhost app or a secure page.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  result.documentHash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
  return result;
}

export function compareByteReceipts(earlier, current) {
  if (!earlier || !current) return {state:'WAITING', title:'Load a current receipt; an earlier receipt is optional.'};
  if (earlier.check !== 'PASS' || current.check !== 'PASS') return {state:'BLOCKED', title:'A byte check failed. Resolve it before comparing continuity.'};
  if (earlier.kind !== current.kind || earlier.revision !== current.revision || earlier.verifier !== current.verifier)
    return {state:'INCOMPATIBLE', title:'These receipts use different input kinds, app revisions or verifier versions.'};
  if (Date.parse(earlier.utc) > Date.parse(current.utc)) return {state:'INCOMPATIBLE', title:'The earlier receipt is dated after the current one. Check your selections.'};
  if (earlier.source !== current.source || earlier.bytes !== current.bytes)
    return {state:'DIFFERENT', title:'The recorded source fingerprint changed.'};
  if (current.previous === 'MATCHED' && current.previousHash !== earlier.documentHash)
    return {state:'INCOMPATIBLE', title:'The current receipt links a different earlier receipt file.'};
  return {state:'MATCHED', title:'The receipts report the same source bytes.',
    linked:current.previous === 'MATCHED' && current.previousHash === earlier.documentHash};
}
