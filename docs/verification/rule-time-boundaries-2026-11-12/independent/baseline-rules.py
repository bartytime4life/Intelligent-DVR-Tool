"""Explicit class-presence rules. This is not identity tracking or anomaly learning."""
from dataclasses import dataclass
import hashlib
import math


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


@dataclass(frozen=True)
class Rule:
    name: str
    label: str
    rect: tuple
    dwell: float = 0
    threshold: float = .7
    max_gap: float = 2

    def __post_init__(self):
        if not isinstance(self.name, str) or not 1 <= len(self.name) <= 60:
            raise ValueError('Rule name must contain 1–60 characters')
        if not isinstance(self.label, str) or not 1 <= len(self.label) <= 80:
            raise ValueError('Use an explicit model label')
        if len(self.rect) != 4 or not all(finite(v) for v in self.rect):
            raise ValueError('rect must be normalized [left, top, width, height]')
        x, y, w, h = self.rect
        if min(x, y) < 0 or min(w, h) <= 0 or x+w > 1 or y+h > 1:
            raise ValueError('rect must be inside the image')
        if not finite(self.dwell) or not 0 <= self.dwell <= 3600:
            raise ValueError('dwell must be 0–3600 seconds')
        if not finite(self.threshold) or not .1 <= self.threshold <= 1:
            raise ValueError('threshold must be .1–1')
        if not finite(self.max_gap) or not 0 < self.max_gap <= 60:
            raise ValueError('max_gap must be >0 and <=60 seconds')


class RuleEngine:
    """Emit once for each run of a class in a zone.

    A run continues while matches are at most max_gap seconds apart, so brief
    misses (occlusion, motion blur) do not start a new run. Different objects of
    the same class may contribute to a run. Never describe dwell as the
    persistence of the same person or object.
    """
    def __init__(self, rules, camera='offline-camera', run_id=''):
        if not isinstance(camera, str) or not 1 <= len(camera) <= 80:
            raise ValueError('camera must contain 1–80 characters')
        if len(rules) > 100 or len({r.name for r in rules}) != len(rules):
            raise ValueError('Use up to 100 uniquely named rules')
        self.rules = rules
        self.camera = camera
        self.run_id = run_id
        self.states = {}
        self.previous = None

    def update(self, seconds, detections):
        if not finite(seconds) or seconds < 0 or (self.previous is not None and seconds <= self.previous):
            raise ValueError('Frame times must be finite, non-negative and strictly increasing')
        # Validate before changing state so a malformed frame cannot advance dwell.
        for d in detections:
            box = d.get('box', [])
            score = d.get('score')
            if len(box) != 4 or not all(finite(v) for v in box) or not finite(score) or not 0 <= score <= 1:
                raise ValueError('Invalid detection')
            x, y, w, h = box
            if min(x,y) < 0 or min(w,h) <= 0 or x+w > 1.000001 or y+h > 1.000001:
                raise ValueError('Invalid normalized detection box')
        self.previous = seconds
        events = []
        for rule in self.rules:
            x, y, w, h = rule.rect
            matches = [d for d in detections if d.get('label') == rule.label and d['score'] >= rule.threshold
                       and x <= d['box'][0]+d['box'][2]/2 <= x+w
                       and y <= d['box'][1]+d['box'][3]/2 <= y+h]
            if not matches:
                continue  # The next match decides whether the gap ended the run.
            state = self.states.get(rule.name)
            if state is None or seconds-state['last'] > rule.max_gap:
                state = {'start': seconds, 'last': seconds, 'emitted': False}
                self.states[rule.name] = state
            state['last'] = seconds
            if not state['emitted'] and seconds-state['start'] >= rule.dwell:
                score = max(d['score'] for d in matches)
                fingerprint = f'{self.run_id}|{self.camera}|{rule!r}|{state["start"]:.6f}|{seconds:.6f}'
                events.append({'id': hashlib.sha256(fingerprint.encode()).hexdigest()[:32],
                               'camera': self.camera, 'label': rule.label, 'score': round(score, 6),
                               'seconds': round(seconds, 6), 'started_seconds': state['start'],
                               'rule': f'{rule.label} present in {rule.name} for {rule.dwell:g}s',
                               'review_required': True})
                state['emitted'] = True
        return events
