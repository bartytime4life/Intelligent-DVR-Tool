"""Explicit inference contracts. Model names and tensor shapes are not licenses."""
import json
from pathlib import Path

DEFAULT_PROFILE = 'yolov8-raw-640'
YOLOX_PROFILE = 'opencv-zoo-yolox-s-2022nov'
PROFILES = (DEFAULT_PROFILE, YOLOX_PROFILE)
ASSETS = Path(__file__).parent


def validate_labels(labels):
    if (not isinstance(labels, list) or not 1 <= len(labels) <= 1000
            or any(not isinstance(x, str) or not 1 <= len(x) <= 80 for x in labels)
            or len(set(labels)) != len(labels)):
        raise ValueError('labels must be a unique JSON array of 1–1000 class names')


def validate_binding(profile, model_sha256, labels):
    validate_labels(labels)
    if profile not in PROFILES:
        raise ValueError('Unknown inference profile')
    if profile == YOLOX_PROFILE:
        candidate = json.loads((ASSETS / 'candidates' / (profile + '.json')).read_text())
        if model_sha256 != candidate['model_sha256']:
            raise ValueError('YOLOX profile requires the exact pinned OpenCV Zoo FP32 artifact')
        expected = json.loads((ASSETS / 'labels' / 'coco80.json').read_text())
        if labels != expected:
            raise ValueError('YOLOX profile requires the verified COCO80 label order')


def prepare(frame, profile, cv2, np):
    if profile not in PROFILES:
        raise ValueError('Unknown inference profile')
    height, width = frame.shape[:2]
    scale = min(640 / width, 640 / height)
    if profile == YOLOX_PROFILE:
        # Match Zoo demo.py: RGB, unnormalized 0..255, floor resize, top-left.
        rw, rh = int(width * scale), int(height * scale)
        left, top, factor = 0, 0, 1.0
    else:
        rw, rh = round(width * scale), round(height * scale)
        left, top, factor = (640 - rw) // 2, (640 - rh) // 2, 1 / 255
    if min(rw, rh) < 1:
        raise ValueError('Frame aspect ratio is unsupported at 640px input')
    image = np.full((640, 640, 3), 114, dtype=np.uint8)
    image[top:top+rh, left:left+rw] = cv2.resize(frame, (rw, rh), interpolation=cv2.INTER_LINEAR)
    blob = cv2.dnn.blobFromImage(image, factor, (640, 640), swapRB=True, crop=False)
    return blob, scale, (left, top)


def yolox_to_yolov8(raw, labels, np):
    """Decode the pinned 3-stride raw YOLOX head, then reuse class-aware NMS."""
    if raw.shape != (1, 8400, 5 + len(labels)) or not np.isfinite(raw).all():
        raise ValueError('Expected finite raw YOLOX output [1,8400,5+C]')
    if (raw[..., 4:] < 0).any() or (raw[..., 4:] > 1).any():
        raise ValueError('Expected YOLOX post-sigmoid objectness and class scores')
    grids, strides = [], []
    for stride in (8, 16, 32):
        side = 640 // stride
        x, y = np.meshgrid(np.arange(side), np.arange(side))
        grids.append(np.stack((x, y), axis=-1).reshape(-1, 2))
        strides.append(np.full((side * side, 1), stride))
    grid, step = np.concatenate(grids), np.concatenate(strides)
    rows = raw[0].astype(np.float64, copy=True)
    try:
        with np.errstate(over='raise', invalid='raise'):
            rows[:, :2] = (rows[:, :2] + grid) * step
            rows[:, 2:4] = np.exp(rows[:, 2:4]) * step
    except FloatingPointError as error:
        raise ValueError('YOLOX box transform overflow') from error
    scores = rows[:, 4:5] * rows[:, 5:]
    return np.concatenate((rows[:, :4], scores), axis=1).T[None]
