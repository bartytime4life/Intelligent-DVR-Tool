"""Consent-based face templates: detect, check quality, embed and compare faces.

Runs only inside the bounded face worker. Templates stay on this computer; a
match is a suggestion for human review, never an identification.
"""
import hashlib
from pathlib import Path

# OpenCV Zoo revision 48b10fa505aeb51fbd127fc60a5c660040e823b7; SHA-256 and size
# from the upstream Git LFS pointers. Licenses apply to every file in each directory.
DETECTOR = {'profile': 'opencv-zoo-yunet-2023mar', 'file': 'face_detection_yunet_2023mar.onnx', 'bytes': 232589,
            'sha256': '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4', 'license': 'MIT'}
RECOGNIZER = {'profile': 'opencv-zoo-sface-2021dec', 'file': 'face_recognition_sface_2021dec.onnx', 'bytes': 38696353,
              'sha256': '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79', 'license': 'Apache-2.0'}
MATCH_THRESHOLD = 0.363  # SFace's published cosine threshold
MATCH_MARGIN = 0.05      # Best person must beat the second-best by this much
MAX_TEMPLATES = 40
DUPLICATE = 0.97         # Near-identical views add nothing to a template
DETECT_EDGE = 640        # YuNet finds faces of about 10-300 px; detect on a reduced copy
MIN_FACE, MIN_SCORE = 60, 0.9
# Laplacian variance of the 112 px aligned face. Measured on webcam clips: close, still
# faces 130-316; distant or moving faces 12-48. Enrollment asks for still, close views.
MIN_SHARPNESS = {'enroll': 60.0, 'verify': 20.0}
BRIGHTNESS = (40, 220)
EMBEDDING = 128


def verify_model(path, spec):
    path = Path(path)
    if path.stat().st_size != spec['bytes']:
        raise ValueError(f'{spec["file"]} is not the pinned {spec["profile"]} model')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    if digest.hexdigest() != spec['sha256']:
        raise ValueError(f'{spec["file"]} is not the pinned {spec["profile"]} model')
    return path


class Models:
    def __init__(self, detector, recognizer, cv2):
        self.cv2 = cv2
        self.detector = cv2.FaceDetectorYN.create(str(detector), '', (320, 320), MIN_SCORE, 0.3, 50)
        self.recognizer = cv2.FaceRecognizerSF.create(str(recognizer), '')

    def detect(self, frame):
        """Face rows (box, five landmarks, score) in full-frame pixels."""
        height, width = frame.shape[:2]
        scale = min(1.0, DETECT_EDGE / max(height, width))
        small = frame if scale == 1 else self.cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))))
        self.detector.setInputSize((small.shape[1], small.shape[0]))
        _, faces = self.detector.detect(small)
        if faces is None:
            return []
        rows = faces.copy()
        rows[:, :14] /= scale
        return list(rows)

    def align(self, frame, row):
        return self.recognizer.alignCrop(frame, row)

    def embed(self, aligned, np):
        feature = self.recognizer.feature(aligned).flatten().astype(np.float64)
        norm = np.linalg.norm(feature)
        if not np.isfinite(norm) or norm == 0:
            raise ValueError('Invalid face embedding')
        return feature / norm


def quality(frame, row, aligned, cv2, mode='enroll'):
    """Empty string when the face is usable, else a fixed reason code."""
    x, y, w, h = (float(v) for v in row[:4])
    if min(w, h) < MIN_FACE:
        return 'small'
    if float(row[14]) < MIN_SCORE:
        return 'unclear'
    height, width = frame.shape[:2]
    if x < 0 or y < 0 or x + w > width or y + h > height:
        return 'edge'
    gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean())
    if brightness < BRIGHTNESS[0]:
        return 'dark'
    if brightness > BRIGHTNESS[1]:
        return 'bright'
    if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < MIN_SHARPNESS[mode]:
        return 'blurry'
    return ''


def best_similarity(embedding, templates, np):
    return float(np.max(np.asarray(templates, dtype=np.float64) @ embedding)) if len(templates) else -1.0


def match(embedding, people, np, threshold=MATCH_THRESHOLD, margin=MATCH_MARGIN):
    """Rank enrolled people; return the top one only if it clears the threshold and the margin."""
    scores = sorted(((best_similarity(embedding, p['embeddings'], np), p['id']) for p in people), reverse=True)
    if not scores or scores[0][0] < threshold:
        return None
    if len(scores) > 1 and scores[0][0] - scores[1][0] < margin:
        return None
    return {'person': scores[0][1], 'similarity': round(scores[0][0], 4)}


def add_diverse(templates, candidates, np, limit=MAX_TEMPLATES):
    """Append views that differ from what is kept; once full, the oldest views give way."""
    kept = [np.asarray(t, dtype=np.float64) for t in templates]
    for vector in candidates:
        if all(float(vector @ k) < DUPLICATE for k in kept):
            kept.append(np.asarray(vector, dtype=np.float64))
    return kept[-limit:]
