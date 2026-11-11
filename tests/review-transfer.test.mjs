import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewOpening, createReviewTransfer} from '../src/review-transfer.mjs';

test('review intent spans independent panels and a rejected newer request still supersedes the old one', async () => {
  const opening = createReviewOpening(), recorder = createReviewTransfer(), backup = createReviewTransfer();
  const oldTransfer = recorder.begin(), oldIntent = opening.begin();
  const newerTransfer = backup.begin(), newerIntent = opening.begin();
  assert.equal(opening.isCurrent(oldIntent), false);
  assert.equal(opening.isCurrent(newerIntent), true);
  // Rejecting a file leaves the displayed review alone, but does not revive an
  // earlier segment download when its transport eventually finishes.
  opening.begin();
  let replaced = false;
  await Promise.resolve();
  if (recorder.isCurrent(oldTransfer) && opening.isCurrent(oldIntent)) replaced = true;
  if (backup.isCurrent(newerTransfer) && opening.isCurrent(newerIntent)) replaced = true;
  assert.equal(replaced, false);
  recorder.finish(oldTransfer); backup.finish(newerTransfer);
});

test('hidden Recognition refuses completions and returning does not revive an older intent', () => {
  let visible = true;
  const opening = createReviewOpening({available:() => visible}), old = opening.begin();
  visible = false;
  assert.equal(opening.isCurrent(old), false);
  assert.equal(opening.begin(), null);
  opening.invalidate(); visible = true;
  assert.equal(opening.isCurrent(old), false);
  assert.equal(opening.isCurrent(opening.begin()), true);
});

test('a panel refuses duplicate transfers and accepts another after completion', () => {
  const transfers = createReviewTransfer(), first = transfers.begin();
  assert.equal(transfers.begin(), null);
  assert.equal(transfers.isCurrent(first), true);
  assert.equal(transfers.finish(first), true);
  assert.equal(transfers.isCurrent(first), false);
  assert.ok(transfers.begin());
  transfers.cancel();
});

test('cancelled work cannot hand off or clear a newer transfer in its late finally', () => {
  const transfers = createReviewTransfer(); let notices = 0, handedOff = false;
  const first = transfers.begin(undefined, () => notices++);
  transfers.cancel();
  assert.equal(first.signal.aborted, true);
  const next = transfers.begin();
  if (transfers.isCurrent(first)) handedOff = true;
  assert.equal(handedOff, false);
  assert.equal(transfers.finish(first), false);
  assert.equal(transfers.isCurrent(next), true);
  assert.equal(notices, 1);
  transfers.finish(next);
});

test('cancelling during asynchronous still storage prevents the Events handoff', async () => {
  const transfers = createReviewTransfer(); let completeStorage, imported = false;
  const operation = transfers.begin();
  const sending = (async () => {
    await new Promise(resolve => {completeStorage=resolve;});
    if (transfers.isCurrent(operation)) imported=true;
    transfers.finish(operation);
  })();
  transfers.cancel(); completeStorage(); await sending;
  assert.equal(imported, false);
});

test('a deadline releases controls even if the underlying decoder stays pending', {timeout:1000}, async () => {
  const transfers = createReviewTransfer({timeout:20});
  let guard;
  try {
    const reason = await new Promise((resolve, reject) => {
      guard=setTimeout(() => reject(Error('Review deadline did not fire')), 500);
      transfers.begin(undefined, resolve);
    });
    assert.equal(reason.name, 'TimeoutError');
    assert.ok(transfers.begin());
  } finally {clearTimeout(guard);transfers.cancel();}
});

test('unmount invalidates active work and an already closed panel cannot begin', () => {
  const lifetime = new AbortController(), transfers = createReviewTransfer();
  const operation = transfers.begin(lifetime.signal);
  lifetime.abort();
  assert.equal(transfers.isCurrent(operation), false);
  assert.equal(transfers.finish(operation), false);
  assert.equal(transfers.begin(lifetime.signal), null);
});
