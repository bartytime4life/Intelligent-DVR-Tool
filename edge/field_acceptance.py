"""Read-only byte comparison for an explicitly approved completed recording.

Reuses the backup library's bounded fingerprinting. No decoder, inference,
network, database writes, camera access or automatic acceptance of field claims.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re

from .backup_library import LibraryError, fingerprint, signature
from .fileops import open_regular


def compare(source, backup, review=None):
    source, backup = Path(source), Path(backup)
    before = [signature(p.lstat()) for p in (source, backup)]
    if os.path.samefile(source, backup):
        raise ValueError('SAME_FILE_OR_HARDLINK')
    original, copied = fingerprint(source), fingerprint(backup)
    if original != copied:
        raise ValueError('BACKUP_HASH_MISMATCH')
    result = {'source_sha256': original, 'backup_sha256': copied,
              'bytes': before[0][2], 'independent_file': True,
              'separate_physical_device': 'NOT_VERIFIED', 'review_binding': 'NOT_RUN'}
    if review is not None:
        with open_regular(Path(review)) as stream:
            review_before = signature(os.fstat(stream.fileno()))
            raw = stream.read(32 * 1024 * 1024 + 1)
            if len(raw) > 32 * 1024 * 1024 or signature(os.fstat(stream.fileno())) != review_before:
                raise ValueError('REVIEW_CHANGED_OR_TOO_LARGE')
        data = json.loads(raw)
        receipt, trace = data['receipt'], data['trace']
        if (data['schema'] != 'intelligent-dvr.recognition-review.v1'
                or receipt['source_sha256'] != original or trace['source_sha256'] != original):
            raise ValueError('REVIEW_SOURCE_MISMATCH')
        for key in ('model_sha256', 'labels_sha256', 'rules_file_sha256'):
            if (not isinstance(receipt.get(key), str)
                    or not re.fullmatch('[0-9a-f]{64}', receipt[key])
                    or receipt[key] != trace.get(key)):
                raise ValueError('REVIEW_ARTIFACT_MISMATCH')
        runtime = receipt['runtime']
        if runtime != trace['runtime'] or runtime['backend_id'] not in ('opencv-cpu', 'onnxruntime-cuda'):
            raise ValueError('REVIEW_RUNTIME_MISMATCH')
        if runtime['backend_id'] == 'onnxruntime-cuda':
            counts = runtime.get('startup_execution', {}).get('node_execution_counts', {})
            if (set(counts) != {'CUDAExecutionProvider'}
                    or type(counts['CUDAExecutionProvider']) is not int
                    or counts['CUDAExecutionProvider'] <= 0):
                raise ValueError('CUDA_EXECUTION_PROOF_MISSING')
        if receipt['state'] not in ('completed', 'partial'):
            raise ValueError('REVIEW_STATE_INVALID')
        result.update(review_binding='MATCHED', review_sha256=hashlib.sha256(raw).hexdigest(),
                      reported_backend=runtime['backend_id'], reported_coverage=receipt['state'])
    if before != [signature(p.lstat()) for p in (source, backup)]:
        raise ValueError('INPUT_CHANGED')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--review', type=Path)
    parser.add_argument('--approved-completed-recording', action='store_true', required=True)
    parser.add_argument('--input-kind', choices=('generated', 'oem'), required=True)
    parser.add_argument('--revision', required=True, help='Tested app commit or kit revision (operator supplied)')
    parser.add_argument('--output', type=Path, required=True, help='New receipt in an existing private folder')
    args = parser.parse_args(argv)
    receipt = {'schema': 'intelligent-dvr.field-byte-check.v1',
               'utc': datetime.now(timezone.utc).isoformat(), 'input_kind': args.input_kind,
               'operator_asserted_completed_and_approved': True,
               'operator_supplied_revision': args.revision,
               'platform': platform.system(), 'python': platform.python_version(),
               'verifier_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'field_acceptance': 'NOT_ESTABLISHED',
               'limits': 'Byte matching and reported review metadata only; not authenticity, decoding, runtime attestation, accuracy, recovery or capacity.'}
    try:
        receipt.update(compare(args.source, args.backup, args.review), check='PASS')
    except (OSError, ValueError, KeyError, TypeError, AttributeError, RuntimeError, LibraryError) as error:
        # Do not export file paths, names or private exception messages.
        code = str(error) if type(error) is ValueError and re.fullmatch('[A-Z_]+', str(error)) else 'INPUT_OR_REVIEW_INVALID'
        receipt.update(check='FAIL', error_type=type(error).__name__, error_code=code)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(receipt, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print('Byte check: ' + receipt['check'] + '; field acceptance NOT_ESTABLISHED')
    return 0 if receipt['check'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
