// navsafe.test.mjs — the guard that keeps a browser race from reading as a bug
// must itself keep the difference between a race and a bug.
//
// The failure it exists to absorb is timing, so it cannot be proved by timing.
// These are the two halves of its contract, stated as values: the one message
// three engines produce becomes "not yet", and everything else is still thrown.
// race.spec.mjs supplies the other half, that the message here is the message
// the engines actually produce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orNotYet, NAVIGATING } from './browser/navsafe.mjs';

// verbatim, as chromium, firefox and webkit each printed it
const LOST = 'page.evaluate: Execution context was destroyed, most likely because of a navigation';

test('a read that loses to a navigation reads as no answer yet', async () => {
  assert.equal(await orNotYet(Promise.reject(new Error(LOST)), ''), '');
  assert.ok(NAVIGATING.test(LOST), 'and the message is one the guard recognises');
});

test('a read that succeeds is handed back untouched', async () => {
  assert.equal(await orNotYet(Promise.resolve('tc_abcdefghijklmnopqrst'), ''), 'tc_abcdefghijklmnopqrst');
});

// The whole hazard of a rescue like this: it can swallow the failures the suite
// exists to report. The club spec forbids the page reaching any host but the
// mock, and that refusal arrives as a rejected read in exactly the same place.
test('any other failure is still a failure', async () => {
  await assert.rejects(
    () => orNotYet(Promise.reject(new Error('this suite may not reach photon.komoot.io')), ''),
    /photon\.komoot\.io/,
    'a forbidden host must not be reported as an empty answer');
  await assert.rejects(
    () => orNotYet(Promise.reject(new TypeError('clubKey is not a function')), ''),
    /not a function/);
});
