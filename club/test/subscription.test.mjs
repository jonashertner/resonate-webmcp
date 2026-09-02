import test from 'node:test';
import assert from 'node:assert/strict';
import { durable } from './fakes.mjs';

const seed = {
  sub: 'sub_1', cus: 'cus_1', until: 1_000, standing: 'good', leaving: false, seq: 99,
};

const transition = (obj, incoming, priority, eventId, at = 100) => obj.transition({
  key: 'tc_0123456789abcdefghjkm', seed,
  incoming: { sub: 'sub_1', ...incoming },
  cursor: { at, priority, tie: eventId }, eventId,
});

test('equal-second payment and opening events cannot resurrect a left or held subscription', async () => {
  const cases = [
    [{ standing: 'left', leaving: false }, 400, { standing: 'good', until: 2_000 }, 100],
    [{ standing: 'left', leaving: false }, 400, { standing: 'good', until: 2_000 }, 250],
    [{ standing: 'held' }, 300, { standing: 'good', until: 2_000 }, 100],
    [{ standing: 'held' }, 300, { standing: 'good', until: 2_000 }, 250],
  ];
  for (const [closed, closedPriority, good, goodPriority] of cases) {
    for (const order of [[closed, closedPriority, good, goodPriority], [good, goodPriority, closed, closedPriority]]) {
      const { obj } = durable('Subscription');
      await transition(obj, order[0], order[1], `evt_${order[1]}`);
      await transition(obj, order[2], order[3], `evt_${order[3]}`);
      const held = await obj.read({ key: 'tc_0123456789abcdefghjkm', seed });
      assert.equal(held.member.standing, closed.standing,
        `${closed.standing} lost to priority ${goodPriority} when deliveries were reversed`);
      assert.equal(held.member.until, 2_000, 'an older paid period was discarded with its standing');
    }
  }
});

test('racing transitions serialize and converge on the deterministic cursor', async () => {
  for (let run = 0; run < 20; run += 1) {
    const { obj } = durable('Subscription');
    await Promise.all([
      transition(obj, { standing: 'good', until: 2_000 }, 100, `evt_paid_${run}`),
      transition(obj, { standing: 'left', leaving: false }, 400, `evt_left_${run}`),
    ]);
    const held = await obj.read({ key: 'tc_0123456789abcdefghjkm', seed });
    assert.equal(held.member.standing, 'left');
    assert.equal(held.member.until, 2_000);
    assert.equal(held.member.seq, 100);
  }
});

test('a lagging KV migration seed fills metadata but cannot overwrite newer object state', async () => {
  const { obj } = durable('Subscription');
  await transition(obj, { standing: 'left', leaving: false }, 400, 'evt_left', 200);
  const stale = {
    sub: 'sub_1', cus: 'cus_stale', until: 5_000,
    standing: 'good', leaving: true, seq: 100,
  };
  const held = await obj.read({ key: 'tc_0123456789abcdefghjkm', seed: stale });
  assert.equal(held.member.standing, 'left');
  assert.equal(held.member.leaving, false);
  assert.equal(held.member.seq, 200);
  assert.equal(held.member.cus, 'cus_1');
  assert.equal(held.member.until, 5_000, 'the monotonic paid-through fact should still merge');
});

test('the event marker and state are one transaction, retained for thirty days', async (t) => {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  t.after(() => { Date.now = real; });

  const held = durable('Subscription');
  held._failTransactionAt(2); // state put succeeds in the transaction copy; event put fails
  await assert.rejects(transition(held.obj, { standing: 'left' }, 400, 'evt_once'));
  assert.equal(held._map.has('state'), false, 'a failed event marker left its state committed');

  const first = await transition(held.obj, { standing: 'left' }, 400, 'evt_once');
  assert.equal(first.again, undefined);
  assert.equal((await transition(held.obj, { standing: 'left' }, 400, 'evt_once')).again, true);

  now += 30 * 24 * 3600 * 1000 + 1;
  const resent = await transition(held.obj, { standing: 'held' }, 500, 'evt_once', 101);
  assert.equal(resent.again, undefined, 'an event older than the documented retention was kept forever');
  assert.equal(resent.member.standing, 'held');
});
