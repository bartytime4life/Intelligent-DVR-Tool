"""Private bounded CPU worker. Uses edge.analyze; no separate inference pipeline."""
import json
import os
from pathlib import Path
import sys
import threading
import time

MEMORY_BYTES = 4 * 1024**3


def watch_parent_pipe():
    """A private stdin pipe is an OS-released lifetime lease on both platforms."""
    if sys.platform == 'win32':
        # Blocking CRT reads hold stdin's descriptor lock, which native video
        # libraries also need. Inspect the anonymous pipe without consuming data.
        import ctypes
        import msvcrt
        from ctypes import wintypes as w
        handle = msvcrt.get_osfhandle(sys.stdin.fileno())
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.PeekNamedPipe.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD,
                                        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        kernel.PeekNamedPipe.restype = w.BOOL
        def watch():
            while kernel.PeekNamedPipe(handle, None, 0, None, None, None):
                time.sleep(.25)
            os._exit(75)
    else:
        def watch():
            os.read(sys.stdin.fileno(), 1)  # No buffered-reader lock during interpreter shutdown.
            os._exit(75)
    threading.Thread(target=watch, daemon=True).start()


def constrain():
    # Applied before importing native inference libraries. CPU is deliberately the
    # first service backend; CUDA's virtual address space needs a separate policy.
    if sys.platform == 'linux':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
        resource.setrlimit(resource.RLIMIT_FSIZE, (34 * 1024**2, 34 * 1024**2))
        resource.setrlimit(resource.RLIMIT_CPU, (300, 301))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        return None
    if sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
                        ('flags', w.DWORD), ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t),
                        ('active', w.DWORD), ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ('r_ops', 'w_ops', 'o_ops', 'r_bytes', 'w_bytes', 'o_bytes')]
        class Extended(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('process_memory', ctypes.c_size_t),
                        ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        kernel.CreateJobObjectW.restype = w.HANDLE
        kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        kernel.SetInformationJobObject.restype = w.BOOL
        kernel.GetCurrentProcess.restype = w.HANDLE
        kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        kernel.AssignProcessToJobObject.restype = w.BOOL
        handle = kernel.CreateJobObjectW(None, None)
        limits = Extended()
        limits.basic.flags = 0x100 | 0x2000  # process memory + kill on job close
        limits.process_memory = MEMORY_BYTES
        if not handle or not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess()):
            raise RuntimeError('Cannot enforce worker memory limit')
        return handle  # Keep the handle open until process exit.
    raise RuntimeError('Bounded analysis service supports Linux and Windows')


def run(directory):
    directory = Path(directory)
    if sys.platform == 'win32' and os.environ.get('DVR_ANALYSIS_PARENT_PIPE') == '1':
        watch_parent_pipe()
    handle = constrain()
    os.environ.update(OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2',
                      OPENCV_FFMPEG_CAPTURE_OPTIONS='protocol_whitelist;file',
                      OPENCV_VIDEOIO_PRIORITY_LIST='FFMPEG')
    from .analyze import main
    args = json.loads((directory / 'args.json').read_text(encoding='utf-8'))
    last = 0
    def progress(**fields):
        nonlocal last
        now = time.monotonic()
        if fields['phase'] == 'analyzing' and now - last < .25:
            return
        last = now
        temporary = directory / 'progress.tmp'
        temporary.write_text(json.dumps(fields), encoding='utf-8')
        temporary.replace(directory / 'progress.json')
    main(args, progress=progress, local_capture=True)
    return handle


if __name__ == '__main__':
    try:
        if sys.platform == 'linux':
            from .supervision import _owned_child
            _owned_child(int(os.environ['DVR_ANALYSIS_PARENT_PID']), run, sys.argv[1])
        else:
            run(sys.argv[1])
    except BaseException:
        # Never send native exceptions, paths or recording details to the browser.
        sys.exit(1)
