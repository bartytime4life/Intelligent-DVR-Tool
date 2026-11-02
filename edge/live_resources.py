"""Separate live CUDA policy: bounded resident memory, not a small VA limit.

CUDA reserves a large virtual address range. CPU workers keep their hard 3 GiB
address-space/Windows committed-memory cap. CUDA on Linux uses a finite 128 TiB
VA ceiling plus a parent RSS watchdog (50 ms samples, transient peaks possible).
Windows keeps the existing hard Job Object committed-memory cap. The CUDA EP's
1 GiB arena setting is not a total VRAM cap.
"""
import os
from pathlib import Path
import sys
import threading

GPU_VIRTUAL_BYTES = 128 * 1024**4
GPU_FILE_BYTES = 40 * 1024**2  # Private pinned YOLOX-S snapshot is 35,858,002 bytes.
RSS_POLL_SECONDS = .05


def constrain_gpu(memory_bytes, cpu_seconds):
    from .analysis_worker import constrain
    if sys.platform not in ('linux', 'win32'):
        raise RuntimeError('Live CUDA policy supports Linux and Windows only')
    if sys.platform == 'linux':
        # Choose the bounded file limit before constrain sets the hard limit;
        # it cannot be raised afterwards. CPU workers retain their 34 MiB cap.
        return constrain(GPU_VIRTUAL_BYTES, cpu_seconds, file_bytes=GPU_FILE_BYTES)
    return constrain(memory_bytes, cpu_seconds)


def resident_bytes(pid):
    values = (Path('/proc') / str(pid) / 'statm').read_text(encoding='ascii').split()
    if len(values) < 2 or not values[1].isdigit():
        raise OSError('Resident memory unavailable')
    return int(values[1]) * os.sysconf('SC_PAGE_SIZE')


def guard(process, memory_bytes, *, platform=None, reader=resident_bytes):
    """Parent-owned monitor; failure to read the live child's RSS also kills it."""
    stopped = threading.Event()
    if (platform or sys.platform) != 'linux':
        return stopped
    # Verify monitoring before the child receives any model configuration.
    try:
        if reader(process.pid) > memory_bytes:
            raise OSError('Resident limit exceeded')
    except Exception:
        process.kill()
        raise RuntimeError('Cannot enforce CUDA resident-memory policy') from None

    def watch():
        while not stopped.wait(RSS_POLL_SECONDS):
            if process.poll() is not None:
                return
            try:
                if reader(process.pid) <= memory_bytes:
                    continue
            except Exception:
                pass
            try:
                process.kill()
            except OSError:
                pass
            return
    threading.Thread(target=watch, daemon=True, name='dvr-live-gpu-memory').start()
    return stopped
