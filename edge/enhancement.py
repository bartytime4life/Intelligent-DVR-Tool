"""Bounded, opt-in frame sharpening comparison. No weights, downloads or files."""
import copy
import hashlib
from pathlib import Path

PROFILE = 'mild-unsharp-v1'
PARAMETERS = {'kernel_size': 5, 'sigma': 1.0, 'amount': 0.5,
              'threshold': 3, 'border': 'reflect-101', 'scale': 1}
SCHEMA = 'intelligent-dvr.enhancement-comparison.v1'


def declaration():
    return {'schema': SCHEMA, 'profile': PROFILE, 'parameters': copy.deepcopy(PARAMETERS),
            'implementation_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'qualification': 'unqualified', 'rule_observations': 'original-only'}


def sharpen(frame, cv2, np):
    """New uint8 BGR image, same geometry; suppress changes below 3 levels/channel.

    This fixed non-learned control is not super-resolution, face restoration or
    evidence that missing scene detail can be recovered. Native threads and
    process limits remain the analyzer/worker's responsibility.
    """
    if (frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3 or
            min(frame.shape[:2]) < 1 or frame.shape[0] * frame.shape[1] > 3840 * 2160):
        raise ValueError('Sharpening requires a uint8 BGR image within the 4K pixel bound')
    blurred = cv2.GaussianBlur(frame, (5, 5), 1.0, borderType=cv2.BORDER_REFLECT_101)
    changed = cv2.addWeighted(frame, 1.5, blurred, -0.5, 0)
    mask = np.abs(frame.astype(np.int16) - blurred.astype(np.int16)) >= 3
    return np.where(mask, changed, frame).astype(np.uint8, copy=False)


def validate_declaration(value, *, current_code=False):
    from .evaluation import require, sha
    expected = declaration()
    require(isinstance(value, dict) and set(value) == set(expected),
            'Invalid enhancement declaration')
    params = value['parameters']
    valid_params = (isinstance(params, dict) and set(params) == set(PARAMETERS) and
                    all(params[k] == v and (type(params[k]) in (int, float) if type(v) in (int, float)
                                           else type(params[k]) is type(v)) for k, v in PARAMETERS.items()))
    require(all(value[k] == expected[k] for k in expected if k not in ('implementation_sha256', 'parameters'))
            and valid_params,
            'Unknown enhancement profile, parameters or qualification')
    sha(value['implementation_sha256'])
    if current_code:
        require(value == expected, 'Enhancement implementation differs from the current evaluator')
    return value


def validate_trace(trace, labels=None, *, current_code=False):
    """Validate the complete paired inventory; unsigned metadata is not attestation."""
    from .evaluation import require, sha, number, box, MAX_DETECTIONS
    present = 'enhancement_comparison' in trace
    frames = trace.get('frames', [])
    if not present:
        require(all('comparison' not in f for f in frames), 'Orphan enhancement samples')
        return None
    metadata = validate_declaration(trace['enhancement_comparison'], current_code=current_code)
    require(isinstance(frames, list) and 1 <= len(frames) <= 10000, 'Invalid enhancement frame inventory')
    count = sum(len(f['detections']) for f in frames)
    keys = {'detections', 'original_processing_ms', 'enhanced_processing_ms',
            'enhancement_ms', 'source_pixels_sha256', 'enhanced_pixels_sha256'}
    for frame in frames:
        value = frame.get('comparison')
        require(isinstance(value, dict) and set(value) == keys, 'Incomplete enhancement samples')
        sha(value['source_pixels_sha256']); sha(value['enhanced_pixels_sha256'])
        for key in ('original_processing_ms', 'enhanced_processing_ms', 'enhancement_ms'):
            number(value[key], key)
        require(value['enhancement_ms'] <= value['enhanced_processing_ms'], 'Invalid enhancement timing')
        detections = value['detections']
        require(isinstance(detections, list), 'Invalid enhanced detections')
        count += len(detections)
        require(count <= MAX_DETECTIONS, 'Paired trace exceeds 100,000 detections')
        for detection in detections:
            require(isinstance(detection, dict) and isinstance(detection.get('label'), str)
                    and 0 < len(detection['label']) <= 80
                    and (labels is None or detection['label'] in labels), 'Invalid enhanced label')
            number(detection.get('score'), 'enhanced score', .1, 1)
            box(detection.get('box'))
    return metadata
