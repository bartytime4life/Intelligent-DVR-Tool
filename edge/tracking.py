"""Short-lived within-camera object tracks from per-frame detections.

The tracker follows ByteTrack's association (Zhang et al., "ByteTrack: Multi-Object
Tracking by Associating Every Detection Box", ECCV 2022) on SORT's constant-velocity
Kalman filter (Bewley et al., "Simple Online and Realtime Tracking", ICIP 2016), with
the noise weights of the ByteTrack/DeepSORT reference implementation:

1. predict every track; split detections into high (score >= high) and low scores;
2. match confirmed and recently lost tracks to high-score boxes by IoU x score;
3. match the still-unmatched tracked tracks to low-score boxes by IoU alone, so a
   briefly occluded or blurred object keeps its track instead of starting a new one;
4. confirm tentative tracks matched again, then start tentative tracks from the
   remaining confident boxes; drop lost tracks after max_lost_seconds.

Optimal assignment uses the Hungarian method (Kuhn 1955; Munkres 1957). Matching is
class-aware: a "person" box never continues a "car" track.

A track ID is a local continuity estimate for one camera in one run. It is not an
identity: IDs can switch when objects cross or overlap, and an object that leaves
and returns gets a new ID. Accuracy is unqualified until measured against labeled
tracks (CLEAR MOT/IDF1/HOTA) on representative footage.
"""
from dataclasses import dataclass
import math

import numpy as np

SCHEMA = 'intelligent-dvr.tracks.v1'
METHOD = 'bytetrack-style-iou-kalman-v1'
# ByteTrack's filter is tuned per frame at 30 FPS. Sampled or live frames arrive at
# other intervals, so motion and noise advance in units of that reference frame.
REFERENCE_FPS = 30.0
WEIGHT_POSITION, WEIGHT_VELOCITY = 1 / 20, 1 / 160
MAX_ACTIVE, MAX_SUMMARIES, MAX_PATH, REPORTED_PATH = 500, 2000, 2000, 32
LIMITATIONS = [
    'Track IDs are short-lived continuity estimates within one camera and run, not identities.',
    'IDs can switch when objects cross or overlap; an object that leaves and returns gets a new ID.',
    'Track continuity is unqualified until compared with labeled tracks on representative footage.',
]


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


@dataclass(frozen=True)
class TrackerConfig:
    high: float = .5          # ByteTrack track_thresh
    new_track: float = .6     # det_thresh = track_thresh + 0.1
    low: float = .1           # low-score floor (also the decoder floor)
    match_iou: float = .2     # first stage: fused IoU x score >= 0.2 (match_thresh 0.8)
    second_iou: float = .5    # second stage: IoU >= 0.5 for low-score boxes
    confirm_iou: float = .3   # tentative tracks: fused >= 0.3 (distance 0.7)
    max_lost_seconds: float = 2.0

    def __post_init__(self):
        for name in ('high', 'new_track', 'low', 'match_iou', 'second_iou', 'confirm_iou'):
            value = getattr(self, name)
            if not finite(value) or not 0 < value <= 1:
                raise ValueError(f'{name} must be in (0, 1]')
        if not self.low <= self.high <= self.new_track:
            raise ValueError('Use low <= high <= new_track score thresholds')
        if not finite(self.max_lost_seconds) or not 0 < self.max_lost_seconds <= 60:
            raise ValueError('max_lost_seconds must be >0 and <=60')

    def describe(self):
        return {'high_score': self.high, 'new_track_score': self.new_track, 'low_score': self.low,
                'first_match_min_iou_x_score': self.match_iou, 'low_score_match_min_iou': self.second_iou,
                'confirm_min_iou_x_score': self.confirm_iou, 'max_lost_seconds': self.max_lost_seconds,
                'reference_fps': REFERENCE_FPS}


def assign(cost, limit):
    """Minimum-cost assignment of rows to columns (Hungarian method with potentials).

    Pairs costing more than limit are infeasible. Returns (matches, unmatched_rows,
    unmatched_cols). Infeasible pairs get a cost so large that the solver first
    maximizes the number of feasible matches, then minimizes their total cost.
    """
    cost = np.asarray(cost, dtype=np.float64)
    rows, cols = cost.shape if cost.ndim == 2 else (0, 0)
    if not rows or not cols:
        return [], list(range(rows)), list(range(cols))
    big = 1e6
    work = np.where(cost <= limit, cost, big)
    transposed = rows > cols
    if transposed:
        work = work.T
    n, m = work.shape  # n <= m
    u, v = np.zeros(n + 1), np.zeros(m + 1)
    owner = np.zeros(m + 1, dtype=np.int64)  # column -> assigned row (1-based, 0 = free)
    way = np.zeros(m + 1, dtype=np.int64)
    for i in range(1, n + 1):
        owner[0], j0 = i, 0
        minv = np.full(m + 1, np.inf)
        used = np.zeros(m + 1, dtype=bool)
        while True:
            used[j0] = True
            i0 = owner[j0]
            free = ~used[1:]
            reduced = work[i0 - 1] - u[i0] - v[1:]
            better = free & (reduced < minv[1:])
            minv[1:][better] = reduced[better]
            way[1:][better] = j0
            candidates = np.where(free, minv[1:], np.inf)
            j1 = int(np.argmin(candidates)) + 1
            delta = candidates[j1 - 1]
            u[owner[used]] += delta
            v[used] -= delta
            minv[1:][free] -= delta
            j0 = j1
            if owner[j0] == 0:
                break
        while j0:
            j1 = way[j0]
            owner[j0] = owner[j1]
            j0 = j1
    matches = []
    for j in range(1, m + 1):
        if owner[j]:
            r, c = (j - 1, owner[j] - 1) if transposed else (owner[j] - 1, j - 1)
            if cost[r, c] <= limit:
                matches.append((int(r), int(c)))
    matched_rows, matched_cols = {r for r, _ in matches}, {c for _, c in matches}
    return (sorted(matches), [r for r in range(rows) if r not in matched_rows],
            [c for c in range(cols) if c not in matched_cols])


def iou(a, b):
    """Pairwise IoU between [N,4] and [M,4] boxes given as [x, y, w, h]."""
    a, b = np.asarray(a, dtype=np.float64).reshape(-1, 4), np.asarray(b, dtype=np.float64).reshape(-1, 4)
    if not len(a) or not len(b):
        return np.zeros((len(a), len(b)))
    ax2, ay2, bx2, by2 = a[:, 0] + a[:, 2], a[:, 1] + a[:, 3], b[:, 0] + b[:, 2], b[:, 1] + b[:, 3]
    w = np.clip(np.minimum(ax2[:, None], bx2[None]) - np.maximum(a[:, None, 0], b[None, :, 0]), 0, None)
    h = np.clip(np.minimum(ay2[:, None], by2[None]) - np.maximum(a[:, None, 1], b[None, :, 1]), 0, None)
    inter = w * h
    union = (a[:, 2] * a[:, 3])[:, None] + (b[:, 2] * b[:, 3])[None] - inter
    return np.where(union > 0, inter / np.maximum(union, 1e-12), 0.)


class Kalman:
    """Constant-velocity filter over [cx, cy, aspect, height] and their rates."""
    H = np.hstack((np.eye(4), np.zeros((4, 4))))

    @staticmethod
    def measure(box):
        x, y, w, h = box
        return np.array([x + w / 2, y + h / 2, w / h, h], dtype=np.float64)

    @staticmethod
    def box(mean):
        cx, cy, a, h = mean[:4]
        h = max(float(h), 1e-6)
        w = max(float(a) * h, 1e-6)
        return [float(cx) - w / 2, float(cy) - h / 2, w, h]

    def initiate(self, z):
        h = z[3]
        std = [2 * WEIGHT_POSITION * h, 2 * WEIGHT_POSITION * h, 1e-2, 2 * WEIGHT_POSITION * h,
               10 * WEIGHT_VELOCITY * h, 10 * WEIGHT_VELOCITY * h, 1e-5, 10 * WEIGHT_VELOCITY * h]
        return np.r_[z, np.zeros(4)], np.diag(np.square(std))

    def predict(self, mean, cov, steps):
        motion = np.eye(8)
        motion[:4, 4:] = np.eye(4) * steps
        h = max(mean[3], 1e-6)
        std = [WEIGHT_POSITION * h, WEIGHT_POSITION * h, 1e-2, WEIGHT_POSITION * h,
               WEIGHT_VELOCITY * h, WEIGHT_VELOCITY * h, 1e-5, WEIGHT_VELOCITY * h]
        # Independent per-frame noise accumulates linearly over the elapsed reference frames.
        noise = np.diag(np.square(std)) * steps
        mean = motion @ mean
        mean[3] = max(mean[3], 1e-6)
        return mean, motion @ cov @ motion.T + noise

    def update(self, mean, cov, z):
        h = max(mean[3], 1e-6)
        innovation_cov = self.H @ cov @ self.H.T + np.diag(np.square(
            [WEIGHT_POSITION * h, WEIGHT_POSITION * h, 1e-1, WEIGHT_POSITION * h]))
        gain = np.linalg.solve(innovation_cov, self.H @ cov).T
        mean = mean + gain @ (z - self.H @ mean)
        cov = cov - gain @ innovation_cov @ gain.T
        return mean, (cov + cov.T) / 2


class _Track:
    __slots__ = ('id', 'label', 'mean', 'cov', 'state', 'first', 'last', 'hits', 'score_max',
                 'score_sum', 'path', 'box', 'zones', 'zone_last')

    def __init__(self, label, mean, cov, seconds, score, box, state):
        self.id, self.label, self.mean, self.cov, self.state = None, label, mean, cov, state
        self.first = self.last = seconds
        self.hits, self.score_max, self.score_sum = 1, score, score
        self.path, self.box, self.zones, self.zone_last = [], box, {}, {}


class Tracker:
    """Online, class-aware multi-object tracker. Feed frames in time order."""

    def __init__(self, config=None, zones=()):
        self.config = config or TrackerConfig()
        self.kalman = Kalman()
        # Zones: (name, label, [x, y, w, h] normalized, max_gap seconds) from the run's rules.
        self.zones = tuple(zones)
        self.tracks = []
        self.finished = []
        self.dropped = 0
        self.next_id = 1
        self.previous = None
        self.size = None

    def update(self, seconds, detections, width, height):
        """Associate one frame's detections; returns a track ID or None per detection.

        None means the box is not (yet) part of a confirmed track.
        """
        if not finite(seconds) or seconds < 0 or (self.previous is not None and seconds <= self.previous):
            raise ValueError('Frame times must be finite, non-negative and strictly increasing')
        if type(width) is not int or type(height) is not int or not 0 < width <= 16384 or not 0 < height <= 16384:
            raise ValueError('Frame dimensions must be positive integers')
        boxes, scores, labels = [], [], []
        for d in detections:
            box, score = d.get('box', []), d.get('score')
            if len(box) != 4 or not all(finite(v) for v in box) or not finite(score) or not 0 <= score <= 1:
                raise ValueError('Invalid detection')
            boxes.append([box[0] * width, box[1] * height, max(box[2] * width, 1e-6), max(box[3] * height, 1e-6)])
            scores.append(float(score)); labels.append(d.get('label'))
        first_frame = self.previous is None
        steps = 0 if first_frame else (seconds - self.previous) * REFERENCE_FPS
        self.previous, self.size = seconds, (width, height)
        for t in self.tracks:
            t.mean, t.cov = self.kalman.predict(t.mean, t.cov, steps)
        cfg = self.config
        result = [None] * len(boxes)
        high = [i for i, s in enumerate(scores) if s >= cfg.high]
        low = [i for i, s in enumerate(scores) if cfg.low <= s < cfg.high]

        def match(tracks, indices, minimum, fused):
            if not tracks or not indices:
                return [], list(tracks), list(indices)
            overlap = iou([self.kalman.box(t.mean) for t in tracks], [boxes[i] for i in indices])
            similarity = overlap * np.array([scores[i] for i in indices])[None] if fused else overlap
            same = np.array([[t.label == labels[i] for i in indices] for t in tracks])
            cost = np.where(same, 1 - similarity, 2.)
            pairs, free_tracks, free_dets = assign(cost, 1 - minimum)
            for r, c in pairs:
                self._hit(tracks[r], indices[c], seconds, boxes, scores, width, height)
            return ([(tracks[r], indices[c]) for r, c in pairs],
                    [tracks[r] for r in free_tracks], [indices[c] for c in free_dets])

        confirmed = [t for t in self.tracks if t.state in ('tracked', 'lost')]
        tentative = [t for t in self.tracks if t.state == 'tentative']
        first, remaining, high_left = match(confirmed, high, cfg.match_iou, True)
        second, remaining, _ = match([t for t in remaining if t.state == 'tracked'], low, cfg.second_iou, False)
        for t in remaining:
            if t.state == 'tracked':
                t.state = 'lost'
        third, unconfirmed, high_left = match(tentative, high_left, cfg.confirm_iou, True)
        for t, _ in third:
            self._confirm(t)
        removed = {id(t) for t in unconfirmed}
        for t, i in first + second + third:
            t.state = 'tracked'
            result[i] = t.id
        for i in high_left:
            if scores[i] < cfg.new_track:
                continue
            if len(self.tracks) - len(removed) >= MAX_ACTIVE:
                self.dropped += 1
                continue
            mean, cov = self.kalman.initiate(self.kalman.measure(boxes[i]))
            track = _Track(labels[i], mean, cov, seconds, scores[i], boxes[i], 'tentative')
            self.tracks.append(track)
            self._record(track, i, seconds, boxes, width, height)
            if first_frame:  # As in ByteTrack, the first frame's confident boxes are confirmed at once.
                self._confirm(track); track.state = 'tracked'; result[i] = track.id
        kept = []
        for t in self.tracks:
            if id(t) in removed:
                continue
            if t.state == 'lost' and seconds - t.last > cfg.max_lost_seconds:
                self._finish(t)
                continue
            kept.append(t)
        self.tracks = kept
        return result

    def _confirm(self, track):
        # Every numbered track keeps a summary. Past the cap a track is still followed
        # (so it cannot spawn duplicates) but gets no number, and is counted as dropped.
        if self.next_id > MAX_SUMMARIES:
            self.dropped += 1
            return
        track.id, self.next_id = self.next_id, self.next_id + 1

    def _hit(self, track, i, seconds, boxes, scores, width, height):
        track.mean, track.cov = self.kalman.update(track.mean, track.cov, self.kalman.measure(boxes[i]))
        if track.state == 'lost':
            track.state = 'tracked'
        track.last, track.hits = seconds, track.hits + 1
        track.score_max, track.score_sum = max(track.score_max, scores[i]), track.score_sum + scores[i]
        track.box = boxes[i]
        self._record(track, i, seconds, boxes, width, height)

    def _record(self, track, i, seconds, boxes, width, height):
        x, y, w, h = boxes[i]
        cx, cy = (x + w / 2) / width, (y + h / 2) / height
        if len(track.path) < MAX_PATH:
            track.path.append((seconds, cx, cy))
        for name, label, rect, gap in self.zones:
            if label != track.label:
                continue
            zx, zy, zw, zh = rect
            if not (zx <= cx <= zx + zw and zy <= cy <= zy + zh):
                continue
            entry = track.zones.setdefault(name, {'entered_seconds': seconds, 'seconds': 0.})
            last = track.zone_last.get(name)
            if last is not None and seconds - last <= gap:
                entry['seconds'] += seconds - last
            track.zone_last[name] = seconds

    def _finish(self, track):
        if track.id is None:
            return
        if len(self.finished) >= MAX_SUMMARIES:
            self.dropped += 1
            return
        self.finished.append(self._summary(track))

    @staticmethod
    def _summary(t):
        path = t.path
        if len(path) > REPORTED_PATH:
            step = (len(path) - 1) / (REPORTED_PATH - 1)
            path = [path[round(k * step)] for k in range(REPORTED_PATH)]
        return {'id': t.id, 'label': t.label, 'first_seconds': round(t.first, 6), 'last_seconds': round(t.last, 6),
                'duration_seconds': round(t.last - t.first, 6), 'hits': t.hits,
                'max_score': round(t.score_max, 6), 'mean_score': round(t.score_sum / t.hits, 6),
                'path': [[round(s, 6), round(x, 5), round(y, 5)] for s, x, y in path],
                'zones': {name: {'entered_seconds': round(z['entered_seconds'], 6), 'seconds': round(z['seconds'], 6)}
                          for name, z in sorted(t.zones.items())}}

    def active(self):
        """Confirmed tracks currently followed, with their last matched box (normalized)."""
        if self.size is None:
            return []
        width, height = self.size
        out = []
        for t in self.tracks:
            if t.id is None:
                continue
            x, y, w, h = t.box
            out.append({'id': t.id, 'label': t.label, 'state': t.state,
                        'first_seconds': round(t.first, 3), 'last_seconds': round(t.last, 3),
                        'duration_seconds': round(t.last - t.first, 3),
                        'box': [round(x / width, 6), round(y / height, 6), round(w / width, 6), round(h / height, 6)],
                        'zones': {n: round(z['seconds'], 3) for n, z in sorted(t.zones.items())}})
        return sorted(out, key=lambda t: t['id'])

    def finish(self):
        """Close every open track and return the run's tracking record."""
        for t in self.tracks:
            self._finish(t)
        self.tracks = []
        tracks = sorted(self.finished, key=lambda t: t['id'])
        return {'schema': SCHEMA, 'method': METHOD, 'parameters': self.config.describe(),
                'tracks': tracks, 'tracks_dropped': self.dropped, 'classes': class_summary(tracks),
                'limitations': list(LIMITATIONS)}


def class_summary(tracks):
    """Per-class track counts and durations. Counts are tracks, not unique people or objects."""
    out = {}
    for t in tracks:
        entry = out.setdefault(t['label'], {'tracks': 0, 'durations': []})
        entry['tracks'] += 1
        entry['durations'].append(t['duration_seconds'])
    summary = {}
    for label, entry in sorted(out.items()):
        ordered = sorted(entry['durations'])
        summary[label] = {'tracks': entry['tracks'], 'median_duration_seconds': round(ordered[len(ordered) // 2], 3),
                          'longest_duration_seconds': round(ordered[-1], 3)}
    return summary


def zones_from_rules(rules):
    """Zone geometry for per-track dwell, taken from the run's explicit Rule objects."""
    return [(r.name, r.label, tuple(r.rect), r.max_gap) for r in rules]
