import test from "node:test";
import assert from "node:assert/strict";
import {
  initialRules,
  initialEvents,
  parseReceipt,
  validateRule,
  reviewEvent,
} from "../src/data.mjs";
test("zone geometry cannot extend beyond image", () => {
  assert.equal(validateRule(initialRules[0]), "");
  assert.match(
    validateRule({ ...initialRules[0], rect: [0.9, 0, 0.2, 0.2] }),
    /inside/,
  );
  assert.match(validateRule({ ...initialRules[0], threshold: NaN }), /score/);
});
test("review records decision without contaminating another event", () => {
  const v = reviewEvent(
    initialEvents,
    initialEvents[0].id,
    "dismissed",
    "verified",
  );
  assert.equal(v[0].status, "dismissed");
  assert.equal(v[1], initialEvents[1]);
  assert.equal(initialEvents[0].status, "pending");
  assert.throws(() => reviewEvent(initialEvents, "x", "ban", ""), /Invalid/);
});
const event = {
  id: "e1",
  camera: "dock",
  label: "person",
  score: 0.9,
  seconds: 12,
  rule: "person in Dock zone",
};
const receipt = {
  schema: "intelligent-dvr.receipt.v1",
  mode: "offline-model",
  state: "completed",
  model_sha256: "a".repeat(64),
  source_sha256: "b".repeat(64),
  events: [event],
};
test("offline receipts remain separate from simulated camera evidence", () => {
  const [e] = parseReceipt(receipt);
  assert.equal(e.camera, null);
  assert.equal(e.mode, "offline-model");
  assert.equal(e.status, "pending");
  assert.equal(e.time, "Clip +12.0s");
});
test("invalid receipts and duplicate ids are rejected", () => {
  for (const value of [
    {},
    { ...receipt, mode: "live" },
    { ...receipt, events: [event, event] },
    { ...receipt, events: [{ ...event, score: Infinity }] },
    { ...receipt, events: [{ ...event, seconds: -1 }] },
  ])
    assert.throws(() => parseReceipt(value));
});
import { restoreSnapshot } from "../src/data.mjs";
test("receipt provenance rejects malformed metadata rather than rendering objects", () => {
  assert.throws(() => parseReceipt({ ...receipt, model_sha256: {} }));
  assert.throws(() => parseReceipt({ ...receipt, state: "complete-ish" }));
  const [e] = parseReceipt({ ...receipt, state: "partial" });
  assert.equal(e.provenance.state, "partial");
  assert.equal(e.provenance.source_sha256, receipt.source_sha256);
});
test("corrupt browser snapshots recover to the initial workspace", () => {
  assert.equal(
    restoreSnapshot("dvr.events.v1", [{ score: "bad" }], initialEvents),
    initialEvents,
  );
  assert.equal(
    restoreSnapshot("dvr.rules.v1", [{}], initialRules),
    initialRules,
  );
  assert.deepEqual(
    restoreSnapshot("dvr.rules.v1", initialRules, []),
    initialRules,
  );
});
