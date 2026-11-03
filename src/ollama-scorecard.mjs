import { compareCounts } from './training.mjs';

const advice = {
  check_fresh: 'Check both settings on a fresh recording before deciding.',
  confirm_prompts: 'Confirm that the person was visible and that the room was empty during the corresponding prompts.',
  repeat_check: 'Repeat the check with at least three scored samples in each condition.',
  review_tradeoff: 'Keep the current setting and review the trade-off on this recording.',
  review_gain: 'Review the improvement on this recording before deciding whether to use the trial setting.',
  keep_current: 'Keep the current setting and review the sampled frames.',
};
const fields = ['currentFound', 'currentFlags', 'trialFound', 'trialFlags'];
export const scoreFormat = {
  type: 'object', additionalProperties: false, required: [...fields, 'action'],
  properties: { ...Object.fromEntries(fields.map(key => [key, { type: 'integer', minimum: 0 }])),
    action: { type: 'string', enum: Object.keys(advice) } },
};
export const scoreInstruction = [
  'Read two DVR settings. Return JSON. Copy found and falseAlarms into currentFound, currentFlags, trialFound, trialFlags. emptyChecks is the sample size, not the flags.',
  'Choose action in this order: calibration = check_fresh; unconfirmed fresh recording = confirm_prompts; fewer than three presentChecks or emptyChecks = repeat_check.',
  'Otherwise more found is good and fewer falseAlarms is good. If one improves and the other worsens = review_tradeoff; any improvement without a loss = review_gain; otherwise keep_current.',
].join(' ');

function mismatch(message, reply) {
  const observed = {};
  for (const key of fields) if (Number.isSafeInteger(reply?.[key])) observed[key] = reply[key];
  if (Object.hasOwn(advice, reply?.action)) observed.action = reply.action;
  return Object.assign(Error(message), { observed });
}

function scorecardAction(evidence) {
  const [before, after] = evidence.settings;
  let action = 'check_fresh';
  if (evidence.stage === 'Fresh check') {
    if (!evidence.promptConditionsConfirmed) action = 'confirm_prompts';
    else if (before.presentChecks < 3 || before.emptyChecks < 3) action = 'repeat_check';
    else {
      const verdict = compareCounts(before, after);
      action = { improved: 'review_gain', tradeoff: 'review_tradeoff' }[verdict] || 'keep_current';
    }
  }
  return action;
}

export function measuredSummary(evidence) {
  const [before, after] = evidence.settings;
  const action = scorecardAction(evidence);
  const sentence = s => `${s.role} found a person in ${s.found} of ${s.presentChecks} in-view samples and flagged ${s.falseAlarms} of ${s.emptyChecks} empty-room samples.`;
  return [sentence(before), sentence(after), advice[action]].join(' ');
}

export function requiredHumanCheck(evidence) {
  if (evidence.stage !== 'Fresh check' || evidence.settings?.length !== 2) return null;
  const action = scorecardAction(evidence);
  return action === 'confirm_prompts' || action === 'repeat_check' ? measuredSummary(evidence) : null;
}

export function verifiedSummary(text, evidence) {
  let reply;
  try { reply = JSON.parse(text); } catch { throw Error('The model did not finish a readable scorecard answer.'); }
  const [before, after] = evidence.settings;
  const values = [before.found, before.falseAlarms, after.found, after.falseAlarms];
  if (fields.some((key, index) => reply?.[key] !== values[index])) throw mismatch('The model misread a count. Use the measured scorecard.', reply);
  if (reply.action !== scorecardAction(evidence)) throw mismatch('The model chose a next step that conflicts with the scorecard. Follow the measured comparison.', reply);
  return measuredSummary(evidence);
}
