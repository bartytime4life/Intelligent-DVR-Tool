import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewTransfer} from '../src/review-transfer.mjs';

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
