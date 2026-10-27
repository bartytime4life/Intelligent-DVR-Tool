"""Read-only Linux/Windows host snapshot for explicit local import into System.

No hostnames, usernames, serials, network addresses, file lists or disk paths are
written. --path selects at most eight volumes to inspect; --gpu is opt-in.
"""
import argparse
import csv
import ctypes
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

SCHEMA = 'intelligent-dvr.host-snapshot.v1'


def physical_memory(system):
    if system == 'linux':
        with open('/proc/meminfo', encoding='ascii') as stream:
            for line in stream:
                if line.startswith('MemTotal:'):
                    return int(line.split()[1]) * 1024
        raise OSError('MemTotal unavailable')
    if system == 'windows':
        from ctypes import wintypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [('length', wintypes.DWORD), ('load', wintypes.DWORD),
                        *[(name, ctypes.c_ulonglong) for name in
                          ('total_phys', 'avail_phys', 'total_page', 'avail_page',
                           'total_virtual', 'avail_virtual', 'avail_extended')]]
        status = MemoryStatus()
        status.length = ctypes.sizeof(status)
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(MemoryStatus)]
        kernel.GlobalMemoryStatusEx.restype = wintypes.BOOL
        if not kernel.GlobalMemoryStatusEx(ctypes.byref(status)):
            raise OSError('GlobalMemoryStatusEx failed')
        return status.total_phys
    raise ValueError('Only Linux and Windows snapshots are supported')


def gpu_snapshot():
    executable = shutil.which('nvidia-smi')
    if not executable:
        return [], 'NVIDIA utility unavailable; GPU inventory is unknown.'
    try:
        r = subprocess.run([executable, '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=5, check=True)
        if len(r.stdout) > 65536:
            raise ValueError('GPU report too large')
        rows = list(csv.reader(io.StringIO(r.stdout)))
        if len(rows) > 16:
            raise ValueError('Too many GPUs')
        gpus = []
        for row in rows:
            if len(row) != 2 or not 1 <= len(row[0].strip()) <= 120:
                raise ValueError('Unexpected GPU report')
            memory = int(row[1].strip())
            if not 1 <= memory <= 1048576:
                raise ValueError('Unexpected GPU memory')
            gpus.append({'name': row[0].strip(), 'memory_mib': memory})
        return gpus, None
    except (OSError, ValueError, subprocess.SubprocessError):
        return [], 'GPU query failed or timed out; GPU inventory is unknown.'


def snapshot(paths=(), include_gpu=False):
    system = platform.system().lower()
    if system not in ('linux', 'windows'):
        raise ValueError('Use this probe on Linux or Windows')
    if len(paths) > 8:
        raise ValueError('Select at most eight volume paths')
    warnings = []
    try:
        ram = physical_memory(system)
    except OSError:
        ram = None
        warnings.append('Physical RAM unavailable; no amount was inferred.')
    logical = os.cpu_count() or 1
    if system == 'linux' and hasattr(os, 'sched_getaffinity'):
        try:
            logical = len(os.sched_getaffinity(0)) or logical
        except OSError:
            pass
    volumes = []
    # Only explicitly selected locations (or cwd by default); no mount enumeration.
    for i, path in enumerate(paths or (Path.cwd(),)):
        disk = shutil.disk_usage(path)
        volumes.append({'label': f'Selected volume {i + 1}', 'total_bytes': disk.total, 'free_bytes': disk.free})
    gpus = []
    if include_gpu:
        gpus, warning = gpu_snapshot()
        if warning:
            warnings.append(warning)
    else:
        warnings.append('GPU query not requested; GPU inventory is unknown.')
    return {'schema': SCHEMA, 'platform': system, 'captured_at': datetime.now(timezone.utc).isoformat(),
            'cpu_logical': logical, 'ram_total_bytes': ram, 'volumes': volumes, 'gpus': gpus,
            'warnings': warnings,
            'scope': 'Read-only point-in-time OS report, not CPU entitlement, RAID health, throughput or a benchmark. '
                     'Selected volumes may be the same filesystem; capacities must not be summed blindly.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--path', type=Path, action='append', default=[])
    parser.add_argument('--gpu', action='store_true', help='Opt in to a read-only nvidia-smi inventory query')
    parser.add_argument('--output', type=Path, required=True, help='New JSON file; will not overwrite')
    args = parser.parse_args(argv)
    try:
        report = snapshot(args.path, args.gpu)
        # Exclusive creation also refuses symlinks; existing evidence is never replaced.
        with args.output.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, indent=2, allow_nan=False)
            stream.write('\n')
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print('Read-only snapshot written. Import it locally in System; no host settings changed.')


if __name__ == '__main__':
    main()
