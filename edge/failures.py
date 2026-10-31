"""Fixed worker failure codes. A child writes at most one allowlisted {"code"} file;
parents accept nothing else. Codes never carry paths, URLs, credentials, addresses
or native messages, so they are safe for status responses and the diagnostic log."""
import contextlib
import json
from pathlib import Path
import signal
import sys

from .fileops import replace
from .media_coverage import MESSAGES as COVERAGE

# Analyzer child (edge.analysis_worker) and parent-observed analysis exits.
ANALYSIS = {**COVERAGE,
    'VIDEO_OPEN_FAILED': 'The analyzer could not open the recording. Check that it plays locally and uses a supported codec; no result was published.',
    'FRAME_RATE_INVALID': 'The recording has no valid frame rate, so rule timing cannot be computed. Re-encode a constant-frame-rate copy and retry.',
    'STRIDE_EXCEEDS_GAP': 'At this recording frame rate the sampling interval exceeds a rule max_gap. Adjust the rules or use a higher-frame-rate recording.',
    'MODEL_LOAD_FAILED': 'The CPU runtime could not load the configured model. Check the model file and its configured profile.',
    'MODEL_OUTPUT_INVALID': 'The model output does not match its configured profile and labels. Check the model, profile and labels file.',
    'INFERENCE_FAILED': 'CPU inference failed on a frame. Check the model and profile; no result was published.',
    'FRAME_TOO_LARGE': 'The recording exceeds the 4K frame bound. Analyze a lower-resolution copy.',
    'NO_FRAMES': 'No frames could be decoded from the recording. Check that it plays locally; no result was published.',
    'DETECTION_LIMIT': 'The recording produced more than 100,000 detections. Split it or raise the rule thresholds.',
    'RESULT_LIMIT': 'The review result would exceed 32 MiB. Split the recording into shorter parts.',
    'INPUT_CHANGED': 'An input changed during analysis. Restore the configured files and retry.',
    'DEPENDENCY_MISSING': 'Required CPU dependencies are missing or incompatible. Rerun the installer.',
    'MEMORY_LIMIT': 'Analysis reached its memory limit. Try a shorter or lower-resolution recording.',
    'CPU_LIMIT': 'Analysis reached its CPU-time limit. Try a shorter recording.',
    'FILE_SIZE_LIMIT': 'Analysis reached its output file-size limit. Split the recording.',
    'WORKER_KILLED': 'The operating system stopped the analyzer, possibly for low memory. Check free memory and retry a shorter recording.',
    'WORKER_CRASHED': 'The analyzer stopped in native code, possibly at its memory limit. Check the recording and model, then retry.',
}
# Segment capture and RTSP/public preview children.
_RTSP = ('STREAM_OPEN_FAILED', 'STREAM_INTERRUPTED', 'UPSTREAM_UNREACHABLE', 'REDIRECT_REFUSED',
         'RTSP_RESPONSE_INVALID', 'RTSP_UNAUTHORIZED', 'RTSP_NOT_FOUND', 'RTSP_STATUS_4XX', 'RTSP_STATUS_5XX',
         'DIMENSIONS_UNSUPPORTED', 'DEPENDENCY_MISSING', 'MEMORY_LIMIT')
CAPTURE = frozenset(_RTSP + ('CAPTURE_DEADLINE', 'ENCODER_UNAVAILABLE', 'SEGMENT_LIMIT', 'SEGMENT_VERIFY_FAILED'))
FEED = frozenset(_RTSP + ('FRAME_LIMIT', 'ADDRESS_REFUSED', 'DNS_FAILED', 'CONNECT_FAILED', 'TLS_VERIFY_FAILED',
    'TLS_FAILED', 'HTTP_TIMEOUT', 'HTTP_STATUS_4XX', 'HTTP_STATUS_5XX', 'HTTP_STATUS_OTHER', 'HTTP_RESPONSE_INVALID',
    'CONTENT_TYPE_REFUSED', 'IMAGE_LIMIT', 'IMAGE_INVALID', 'IMAGE_TIMEOUT', 'MJPEG_INVALID'))
EXITS = frozenset({'CPU_LIMIT', 'FILE_SIZE_LIMIT', 'MEMORY_LIMIT', 'WORKER_KILLED', 'WORKER_CRASHED'})


class Failure(ValueError):
    """A ValueError carrying a fixed code; str() stays the local CLI/test message."""
    def __init__(self, code, message=None):
        super().__init__(message or code)
        self.failure = code


def tag(code, error):
    """Attach a code without changing an exception's type or message."""
    if getattr(error, 'failure', None) is None:
        error.failure = code(error) if callable(code) else code
    return error


@contextlib.contextmanager
def failing(code):
    try:
        yield
    except Exception as error:
        tag(code, error)
        raise


def code_of(error):
    # Python MemoryError (RLIMIT_AS, Windows job commit) or cv2.error StsNoMem (-4).
    if isinstance(error, MemoryError) or (type(error).__module__ == 'cv2' and getattr(error, 'code', None) == -4):
        return 'MEMORY_LIMIT'
    if isinstance(error, ImportError):
        return 'DEPENDENCY_MISSING'
    code = getattr(error, 'failure', None)
    return code if isinstance(code, str) else None


def record(directory, error, allowed):
    """Child side, best effort: replace failure.json with one allowlisted code."""
    code = code_of(error)
    if code not in allowed:
        return None
    with contextlib.suppress(OSError):
        temporary = Path(directory) / 'failure.tmp'
        temporary.write_text(json.dumps({'code': code}), encoding='utf-8')
        replace(temporary, Path(directory) / 'failure.json')
        return code


def read(directory, allowed):
    """Parent side: exactly {"code": <allowlisted>} in at most 1 KiB, else None."""
    from .evaluation import read_json
    try:
        value = read_json(Path(directory) / 'failure.json', 1024)
    except (OSError, ValueError):
        return None
    if isinstance(value, dict) and set(value) == {'code'} and isinstance(value['code'], str) and value['code'] in allowed:
        return value['code']
    return None


def exit_cause(returncode):
    """Classify a nonzero exit that left no failure file: POSIX signals, Windows NTSTATUS."""
    if returncode is None or returncode >= 0 and sys.platform != 'win32':
        return None
    if returncode < 0:
        number = -returncode
        return {getattr(signal, 'SIGXCPU', 24): 'CPU_LIMIT', getattr(signal, 'SIGXFSZ', 25): 'FILE_SIZE_LIMIT',
                getattr(signal, 'SIGKILL', 9): 'WORKER_KILLED'}.get(number, 'WORKER_CRASHED')
    if returncode >= 0xC0000000:  # STATUS_NO_MEMORY / STATUS_COMMITMENT_LIMIT, else an unhandled native exception
        return 'MEMORY_LIMIT' if returncode in (0xC0000017, 0xC000012D) else 'WORKER_CRASHED'
    return None
