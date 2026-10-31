"""Local, bounded recording coverage checks, separate from model inference."""
import math

SCHEMA = 'intelligent-dvr.media-coverage.v1'
MESSAGES = {
    'MEDIA_DEPENDENCY': 'Recording validation requires the optional PyAV dependency. Run the current installer or install the edge requirements, then retry.',
    'MEDIA_UNSUPPORTED': 'Recording validation requires one supported local video track within the recording limits. No result was published.',
    'MEDIA_CORRUPT': 'The recording failed strict decoding or contains corrupt media. Keep the original file and obtain a complete recording before retrying. No result was published.',
    'MEDIA_INCOMPLETE': 'Analysis stopped before the independently decoded recording ended. No completed result was published; keep the source and retry or inspect the recording.',
    'MEDIA_INVENTORY_MISMATCH': 'Decoded recording coverage does not match its reported frame count or duration. Keep the source and inspect or obtain a complete recording. No result was published.',
}


class CoverageError(ValueError):
    def __init__(self, code):
        self.code = self.failure = code  # failure: the worker's fixed failure-file code.
        super().__init__(MESSAGES[code])


def container_format(header):
    if header[:4] == b'RIFF' and header[8:12] == b'AVI ':
        return 'avi'
    if header[:4] == b'\x1aE\xdf\xa3':
        return 'matroska'
    if header[4:8] == b'ftyp':
        return 'mov'
    raise CoverageError('MEDIA_UNSUPPORTED')


def unchecked(source_hash, frames, termination):
    return {'schema': SCHEMA, 'source_sha256': source_hash, 'status': 'not-checked',
            'termination': termination, 'analysis_frames': frames, 'validated_frames': 0,
            'declared_frames': None, 'declared_duration_seconds': None,
            'decoded_duration_seconds': None, 'duration_tolerance_seconds': None,
            'anchor': 'none', 'validator_version': None}


def verify(source, source_hash, observed_frames, progress=None):
    """Check an alleged EOF using strict decode plus available inventory anchors.

    Decode at most observed_frames + 1 frames: an additional frame already proves
    the analyzer stopped early. A clean native EOF alone never certifies coverage.
    Native calls run within the service worker's existing time/memory limits.
    """
    from .evaluation import local_file, digest
    source = local_file(source)
    if not 16 <= source.stat().st_size <= 512 * 1024**2 or type(observed_frames) is not int or not 1 <= observed_frames <= 100000:
        raise CoverageError('MEDIA_UNSUPPORTED')
    try:
        import av
    except ImportError:
        raise CoverageError('MEDIA_DEPENDENCY') from None
    with source.open('rb') as data:
        fmt = container_format(data.read(16)); data.seek(0)
        try:
            with av.open(data, format=fmt, options={'protocol_whitelist': 'file',
                    'enable_drefs': '0', 'use_absolute_path': '0',
                    'err_detect': 'crccheck+bitstream+buffer+explode'}) as container:
                if len(container.streams.video) != 1 or len(container.streams) > 16:
                    raise CoverageError('MEDIA_UNSUPPORTED')
                video = container.streams.video[0]
                codec = video.codec_context
                if codec is None or not 0 < codec.width * codec.height <= 3840 * 2160:
                    raise CoverageError('MEDIA_UNSUPPORTED')
                size = (codec.width, codec.height)
                codec.thread_count = 1
                codec.options = {**codec.options, 'err_detect': 'crccheck+bitstream+buffer+explode'}
                declared_frames = video.frames if video.frames > 0 else None
                duration = None
                container_duration = False
                if video.duration is not None and video.time_base is not None:
                    duration = float(video.duration * video.time_base)
                elif len(container.streams) == 1 and container.duration is not None:
                    # Container duration can include longer audio; never use it for mixed tracks.
                    duration = float(container.duration / av.time_base)
                    container_duration = True
                if duration is not None and (not math.isfinite(duration) or duration <= 0):
                    duration = None
                first = last_end = None
                count = 0
                timing_valid = True
                previous = None
                tick = .001
                for packet in container.demux(video):
                    if packet.is_corrupt:
                        raise CoverageError('MEDIA_CORRUPT')
                    for frame in packet.decode():
                        count += 1
                        if count > observed_frames:
                            raise CoverageError('MEDIA_INCOMPLETE')
                        if frame.is_corrupt or (frame.width, frame.height) != size:
                            raise CoverageError('MEDIA_CORRUPT')
                        if frame.pts is None or frame.time_base is None:
                            timing_valid = False
                        else:
                            seconds = float(frame.pts * frame.time_base)
                            if not math.isfinite(seconds) or (previous is not None and seconds <= previous):
                                timing_valid = False
                            if first is None:
                                first = seconds
                            previous = seconds
                            tick = max(tick, float(frame.time_base))
                            last_end = seconds + float(frame.duration * frame.time_base) if frame.duration > 0 else None
                        if progress is not None:
                            progress(count)
                if count != observed_frames:
                    raise CoverageError('MEDIA_INVENTORY_MISMATCH')
                if declared_frames is not None and declared_frames != count:
                    raise CoverageError('MEDIA_INVENTORY_MISMATCH')
                # Container duration can describe an extent from timeline zero,
                # rather than the span from the first frame. Do not guess a
                # normalization for nonzero/unknown origins (e.g. valid WebM).
                if container_duration and (not timing_valid or first is None or abs(first) > tick / 2 + .000001):
                    duration = None
                decoded_duration = last_end - first if timing_valid and first is not None and last_end is not None else None
                duration_checked = duration is not None and decoded_duration is not None
                tolerance = tick / 2 + .000001 if duration_checked else None
                if duration_checked and abs(duration - decoded_duration) > tolerance:
                    raise CoverageError('MEDIA_INVENTORY_MISMATCH')
                anchors = (['frames'] if declared_frames is not None else []) + (['duration'] if duration_checked else [])
                result = {**unchecked(source_hash, observed_frames, 'source-end'),
                          'status': 'inventory-matched' if anchors else 'unverified',
                          'validated_frames': count, 'declared_frames': declared_frames,
                          'declared_duration_seconds': duration,
                          'decoded_duration_seconds': decoded_duration,
                          'duration_tolerance_seconds': tolerance,
                          'anchor': '+'.join(anchors) if anchors else 'none',
                          'validator_version': av.__version__}
        except CoverageError:
            raise
        except (av.error.FFmpegError, ValueError, OverflowError):
            raise CoverageError('MEDIA_CORRUPT') from None
    if digest(source) != source_hash:
        raise CoverageError('MEDIA_INVENTORY_MISMATCH')
    return result


def validate(value, source_hash, frames, state):
    """Validate declarations without loading native libraries; hashes are not signatures."""
    from .evaluation import require, sha, integer, number
    require(isinstance(value, dict) and set(value) == set(unchecked(source_hash, frames, 'source-end')),
            'Invalid media coverage declaration')
    require(value['schema'] == SCHEMA and sha(value['source_sha256']) == source_hash
            and value['analysis_frames'] == frames, 'Media coverage source/frame mismatch')
    integer(value['analysis_frames'], 'coverage analysis frames', 1, 100000)
    integer(value['validated_frames'], 'coverage validated frames', 0, 100000)
    require(value['status'] in ('not-checked', 'unverified', 'inventory-matched'), 'Unknown media coverage status')
    require(value['termination'] in ('source-end', 'frame-limit', 'event-limit'), 'Unknown analysis termination')
    for key in ('declared_duration_seconds', 'decoded_duration_seconds'):
        if value[key] is not None:
            number(value[key], key, .000000001, 1e12)
    if value['duration_tolerance_seconds'] is not None:
        number(value['duration_tolerance_seconds'], 'duration tolerance', .000000001, 3600)
    if value['declared_frames'] is not None:
        integer(value['declared_frames'], 'declared frame count', 1, 100000)
    if value['status'] == 'not-checked':
        require(state == 'partial' and value == unchecked(source_hash, frames, value['termination'])
                and value['termination'] != 'source-end', 'Invalid unchecked coverage')
        return value
    require(value['termination'] == 'source-end' and value['validated_frames'] == frames and
            isinstance(value['validator_version'], str) and 0 < len(value['validator_version']) <= 40,
            'Invalid decoded coverage')
    require(value['declared_frames'] is None or value['declared_frames'] == frames, 'Coverage frame inventory differs')
    anchors = (['frames'] if value['declared_frames'] is not None else []) + (
        ['duration'] if value['declared_duration_seconds'] is not None and value['decoded_duration_seconds'] is not None else [])
    if 'duration' in anchors:
        require(value['duration_tolerance_seconds'] is not None and
                abs(value['declared_duration_seconds'] - value['decoded_duration_seconds']) <= value['duration_tolerance_seconds'],
                'Coverage duration inventory differs')
    else:
        require(value['duration_tolerance_seconds'] is None, 'Unexpected duration tolerance')
    require(value['anchor'] == ('+'.join(anchors) if anchors else 'none'), 'Invalid coverage inventory anchor')
    require((state == 'completed' and value['status'] == 'inventory-matched' and bool(anchors)) or
            (state == 'partial' and value['status'] == 'unverified' and not anchors), 'Coverage does not justify analysis state')
    return value
