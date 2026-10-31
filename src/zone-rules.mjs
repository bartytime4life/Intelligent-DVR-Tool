import { FACILITY_CLASSES } from './facility-zones.mjs';
import { validateRule } from './data.mjs';

export const ANALYZER_CLASSES = FACILITY_CLASSES;
export const DEFAULT_MAX_GAP = 2;
const round = v => Math.round(v * 1e4) / 1e4;

// The analyzer (edge/rules.py) takes a bare list of {name, label, rect, dwell, threshold, max_gap}
// with rect as normalized full-frame [left, top, width, height] strictly inside the image.
export function analyzerRules(rule) {
  if (!rule.enabled) throw Error('Enable this rule before exporting it for the analyzer.');
  if (!ANALYZER_CLASSES.includes(rule.label)) throw Error('Choose a model class such as person or car before exporting. “object” is not a model label.');
  const problem = validateRule(rule);
  if (problem) throw Error(problem);
  const maxGap = rule.maxGap ?? DEFAULT_MAX_GAP;
  if (!Number.isFinite(maxGap) || maxGap <= 0 || maxGap > 60) throw Error('Allowed gap must be more than 0 and at most 60 seconds.');
  const x = round(Math.max(0, rule.rect[0])), y = round(Math.max(0, rule.rect[1]));
  let w = round(rule.rect[2]), h = round(rule.rect[3]);
  // The browser accepts a 0.001 edge tolerance; the analyzer does not.
  while (x + w > 1) w = round(w - 1e-4);
  while (y + h > 1) h = round(h - 1e-4);
  return [{name: rule.name.trim(), label: rule.label, rect: [x, y, w, h], dwell: rule.dwell, threshold: rule.threshold, max_gap: maxGap}];
}

export const analyzerFilename = rule => `dvr-rules-plan-${rule.camera}-${rule.label.replace(/[^a-z0-9]+/gi, '-')}.json`;
