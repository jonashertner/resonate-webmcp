// The paid tier, from the ask to the way out.
//
// What is proved here: the session is made by the club and not by a link, at
// one price with adaptive pricing refused; the door opens only for the device
// that began the payment and only on the exact thing we sell; a club that
// cannot reach Stripe says so in its own words instead of blaming a card; the
// membership begins at the webhook and the door only collects it; a delivery
// that arrives twice, or out of order, changes nothing it should not; and a
// cancellation that is reversed stops being announced.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { REQUEST_LIMITS } from '../src/worker.js';
import { createCheckout, API_VERSION } from '../src/stripe.js';
import { isKey, commitmentOf, admits, patchFor, standingOf, mintKeyFor } from '../src/validate.js';
import { kv, durableNamespace } from './fakes.mjs';

const PRICE = 'price_the_only_one';
const SECRET = 'a3'.repeat(16);       // one device's secret
const OTHER = 'b7'.repeat(16);        // another's, never shared
const req = (path, { method = 'GET', body, headers = {} } = {}) =>
  new Request(`https://club.example${path}`, { method, body, headers });

const clubEnv = (over = {}) => {
  const env = {
    BOX: kv(),
    STRIPE_SECRET: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE: PRICE,
    MINT_SECRET: 'f'.repeat(64),
    SITE: 'https://resonate.select',
    ...over,
  };
  if (!env.SUBSCRIPTIONS) env.SUBSCRIPTIONS = durableNamespace('Subscription');
  return env;
};

// a session in the shape Stripe answers with, expanded, and paid
async function session(over = {}, { secret = SECRET } = {}) {
  return {
    id: 'cs_test_abc',
    livemode: false,
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    customer: 'cus_1',
    metadata: { claim: await commitmentOf(secret) },
    subscription: {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 2_000_000_000,
      items: {
        data: [{
          quantity: 1,
          price: { id: PRICE, currency: 'chf', recurring: { interval: 'year', interval_count: 1 } },
        }],
      },
    },
    ...over,
  };
}

// Stripe, answered from a table. Every call is recorded, so a test can say
// what was sent as well as what came back.
function stripe(t, answer) {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const call = { url: String(u), method: init.method || 'GET', headers: init.headers || {}, body: init.body || '' };
    seen.push(call);
    const r = await answer(call);
    return r instanceof Response ? r : new Response(JSON.stringify(r ?? {}), { status: 200 });
  };
  t.after(() => { globalThis.fetch = real; });
  return seen;
}

const knock = (body) => req('/door', { method: 'POST', body: JSON.stringify(body) });

// Two timestamps, and they are not the same timestamp.
//
// Stripe signs with the moment of delivery, and that signature is refused
// after five minutes: a test that dated its signature 2000 would only ever be
// testing the five-minute window. When an event was MADE is a separate number,
// carried in the body, and it is the one that decides what may undo what. The
// event id is fresh every time, because an id reused is a delivery the club is
// right to ignore, which is a different test.
let evn = 0;
async function signed(env, ev, made, id) {
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: id || `evt_${++evn}`, created: made ?? now, ...ev });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${now}.${body}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return req('/stripe', { method: 'POST', body, headers: { 'stripe-signature': `t=${now},v1=${hex}` } });
}

// what the events in these tests are dated: an hour of subscription life,
// close enough to now that every signature is honest
const T = Math.floor(Date.now() / 1000);

// ---------- the payment desk ----------

test('the session is made here, at one price, with adaptive pricing refused', async (t) => {
  const seen = stripe(t, () => ({ id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/cs_test_new' }));
  const env = clubEnv();
  const commitment = await commitmentOf(SECRET);

  const r = await worker.fetch(req('/checkout', { method: 'POST', body: JSON.stringify({ claim: commitment }) }), env);
  assert.equal(r.status, 200);
  const got = await r.json();
  assert.equal(got.session, 'cs_test_new');
  assert.match(got.url, /^https:\/\/checkout\.stripe\.com\//);

  const call = seen[0];
  const form = new URLSearchParams(call.body);
  assert.equal(call.method, 'POST');
  assert.match(call.url, /\/checkout\/sessions$/);
  assert.equal(call.headers['stripe-version'], API_VERSION, 'the api version is pinned on every call');
  assert.equal(call.headers['idempotency-key'], `join:${commitment}`, 'a second press is the same session');
  assert.equal(form.get('mode'), 'subscription');
  assert.equal(form.get('line_items[0][price]'), PRICE, 'one price, named');
  assert.equal(form.get('line_items[0][quantity]'), '1');
  assert.equal(form.get('adaptive_pricing[enabled]'), 'false',
    'a link cannot refuse adaptive pricing, which is the whole reason this is not a link');
  assert.equal(form.get('payment_method_types[0]'), 'card');
  assert.equal(form.get('allow_promotion_codes'), 'false');
  assert.equal(form.get('metadata[claim]'), commitment, 'the device is bound before the payment, not after');
  assert.equal(form.get('subscription_data[metadata][claim]'), commitment,
    'and on the subscription too, which outlives the session');
  assert.equal(form.get('success_url'), 'https://resonate.select/?club={CHECKOUT_SESSION_ID}');
  assert.equal(form.get('currency'), null, 'the price carries its own currency and is not contradicted here');
});

test('a payment desk that is not configured refuses before it asks, and never as a refused payment', async (t) => {
  // Two claims, and they are separate. A club missing a secret must not reach
  // Stripe at all, because there is nothing coherent to ask; and whichever way
  // it fails, it must not answer with the sentence an unpaid session gets.
  // Until a moment ago this test proved only the second, and a `ready` check
  // deleted from the worker did not make it red.
  let answer = () => ({ id: 'cs_x', url: 'https://checkout.stripe.com/c/pay/x' });
  const seen = stripe(t, c => answer(c));
  const commitment = await commitmentOf(SECRET);
  const desk = () => req('/checkout', { method: 'POST', body: JSON.stringify({ claim: commitment }) });

  for (const missing of ['STRIPE_SECRET', 'STRIPE_PRICE', 'MINT_SECRET']) {
    seen.length = 0;
    const env = clubEnv({ [missing]: '' });
    const made = await worker.fetch(desk(), env);
    assert.equal(made.status, 503, `${missing} missing, and the desk made a session anyway`);
    const door = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
    assert.equal(door.status, 503, `${missing} missing, and the door blamed the payment`);
    assert.match((await door.json()).error, /ours to fix/);
    assert.equal(seen.length, 0, `${missing} missing, and stripe was troubled about it`);
  }

  // and a key that Stripe itself rejects is the same class of failure: the
  // member is not told their payment was refused because our key was
  answer = () => new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 });
  const env = clubEnv();
  const r = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
  assert.equal(r.status, 503, 'a rejected api key is not a refused card');
  assert.match((await r.json()).error, /ours to fix/);
  const made = await worker.fetch(desk(), env);
  assert.equal(made.status, 503);
});

// ---------- the door ----------

test('the door opens for the device that began the payment, and for no other', async (t) => {
  const env = clubEnv();
  stripe(t, async () => session());

  const opened = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
  assert.equal(opened.status, 200);
  const first = await opened.json();
  assert.ok(isKey(first.key));
  assert.equal(first.until, 2_000_000_000);

  // the answer was eaten by a mobile network. the same device asks again, and
  // again, and is handed the same key: there is no window, because the proof
  // is the secret and not the timing.
  for (const nth of [1, 2, 3]) {
    const again = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
    assert.equal(again.status, 200, `ask ${nth}`);
    const j = await again.json();
    assert.equal(j.key, first.key, 'the same key, not a second membership');
    assert.equal(j.again, true, 'and it says it is a second telling');
  }

  // a stranger holding the session id holds nothing. the session id is in a
  // browser history, a receipt and a support thread; it is not a credential.
  const stranger = await worker.fetch(knock({ session: 'cs_test_abc', secret: OTHER }), env);
  assert.equal(stranger.status, 403);
  assert.match((await stranger.json()).error, /another device/);

  // exactly one membership was ever minted
  const minted = [...env.BOX._m.keys()].filter(k => k.startsWith('member:'));
  assert.deepEqual(minted, [`member:${first.key}`]);
});

test('the door refuses everything that is not the one thing we sell', async (t) => {
  const shown = await commitmentOf(SECRET);
  const live = false;
  const base = await session();
  const bend = async (over, subOver) => {
    const s = { ...base, ...over };
    if (subOver) s.subscription = { ...base.subscription, ...subOver };
    return admits(s, { prices: [PRICE], live, shown });
  };

  assert.equal(await bend({}), '', 'the real thing passes, or nothing below means anything');
  assert.equal(await bend({ livemode: true }), 'livemode', 'a live session at a test club');
  assert.equal(await bend({ mode: 'payment' }), 'mode', 'a one-off payment is not a membership');
  assert.equal(await bend({ status: 'open' }), 'incomplete');
  assert.equal(await bend({ payment_status: 'unpaid' }), 'unpaid');
  assert.equal(await bend({ metadata: {} }), 'no-claim', 'a session bound to nobody');
  assert.equal(await bend({ metadata: { claim: await commitmentOf(OTHER) } }), 'claim');
  assert.equal(await bend({ subscription: 'sub_1' }), 'no-subscription',
    'an unexpanded subscription is a key without the scope to read one, not a membership');
  assert.equal(await bend({}, { status: 'incomplete' }), 'status');
  assert.equal(await bend({}, { items: { data: [] } }), 'items');
  assert.equal(await bend({}, { items: { data: [base.subscription.items.data[0], base.subscription.items.data[0]] } }), 'items');

  const item = base.subscription.items.data[0];
  const withItem = over => ({ items: { data: [{ ...item, ...over }] } });
  assert.equal(await bend({}, withItem({ price: { ...item.price, id: 'price_other' } })), 'price',
    'paid, and for something else');
  assert.equal(await bend({}, withItem({ quantity: 9 })), 'quantity');
  assert.equal(await bend({}, withItem({ price: { ...item.price, currency: 'usd' } })), 'currency');
  assert.equal(await bend({}, withItem({ price: { ...item.price, recurring: { interval: 'month', interval_count: 1 } } })), 'interval');
  assert.equal(await bend({}, withItem({ price: { ...item.price, recurring: { interval: 'year', interval_count: 3 } } })), 'interval');
  assert.equal(await bend({}, { current_period_end: 0, items: { data: [{ ...item, current_period_end: 0 }] } }), 'period');

  // the reason never travels: a refusal that enumerates its checks is a recipe
  const env = clubEnv();
  stripe(t, async () => session({ status: 'open' }));
  const r = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'the door only opens on a paid subscription');
});

test('a live club refuses a test session, and the reverse', async (t) => {
  const env = clubEnv({ STRIPE_SECRET: 'rk_live_123' });
  stripe(t, async () => session());
  const r = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
  assert.equal(r.status, 403, 'a test-mode session opened a live door');
  assert.deepEqual([...env.BOX._m.keys()], [], 'and nothing was written');
});

test('the door does not spend an api call on a request that cannot be right', async (t) => {
  const env = clubEnv();
  const seen = stripe(t, async () => session());
  assert.equal((await worker.fetch(knock({ session: 'not_a_session', secret: SECRET }), env)).status, 400);
  assert.equal((await worker.fetch(knock({ session: 'cs_test_abc', secret: 'short' }), env)).status, 400);
  assert.equal((await worker.fetch(knock({ session: 'cs_test_abc' }), env)).status, 400);
  assert.equal(seen.length, 0, 'stripe was troubled by a malformed ask');
});

// ---------- the membership begins at the webhook ----------

test('the membership begins before the member gets home, and the door only collects it', async (t) => {
  const env = clubEnv();
  stripe(t, async () => session());

  // the buyer paid and closed the tab. the webhook arrives anyway.
  const hook = await worker.fetch(await signed(env, {
    type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc' } },
  }), env);
  assert.equal(hook.status, 200);
  const key = await mintKeyFor('sub_1', env.MINT_SECRET);
  const m = await env.BOX.get(`member:${key}`, 'json');
  assert.ok(m, 'the payment landed and no membership exists');
  assert.equal(m.until, 2_000_000_000);
  assert.equal(m.cus, 'cus_1', 'and the billing account is on file, so leaving is possible');

  // and coming back later is a collection, not a second minting
  const r = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
  const got = await r.json();
  assert.equal(got.key, key, 'the door minted a second key over a membership that existed');
  assert.equal(got.again, true);
  assert.deepEqual([...env.BOX._m.keys()].filter(k => k.startsWith('member:')), [`member:${key}`]);
});

test('the same delivery twice changes nothing, and stripe is not asked twice', async (t) => {
  const env = clubEnv();
  const seen = stripe(t, async () => session());
  const ev = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc' } } };

  const first = await worker.fetch(await signed(env, ev, T, 'evt_twice'), env);
  const second = await worker.fetch(await signed(env, ev, T, 'evt_twice'), env);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).again, true, 'a second delivery was treated as news');
  assert.equal(seen.length, 1, 'the session was read from stripe twice for one event');
});

// Every other webhook test in this file arrives correctly signed, so all of
// them together said nothing about what happens to a delivery that is not. The
// gap was proved rather than suspected: with the refusal at worker.js deleted
// outright, so that /stripe accepted anything at all, the whole suite still
// passed 45 of 45. An unsigned forgery could have opened a membership and
// nothing here would have said a word.
//
// So this asks for the refusal itself, in the three shapes it has to hold: no
// signature, a signature that is not one, and a real signature over some other
// body. Each must be answered 400, must leave no event marked handled, and
// must not have called Stripe at all.
test('a delivery that is not signed is not a delivery', async (t) => {
  const env = clubEnv();
  const seen = stripe(t, async () => session());
  const body = JSON.stringify({
    id: 'evt_forged', created: T,
    type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc' } },
  });
  const now = Math.floor(Date.now() / 1000);

  // a real signature, over a body that is not the one being sent
  const other = JSON.stringify({ id: 'evt_forged', created: T, type: 'invoice.paid' });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${now}.${other}`));
  const elsewhere = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  const shapes = [
    ['no signature at all', {}],
    ['a signature that is not one', { 'stripe-signature': `t=${now},v1=deadbeef` }],
    ['a real signature over another body', { 'stripe-signature': `t=${now},v1=${elsewhere}` }],
  ];
  for (const [what, headers] of shapes) {
    const r = await worker.fetch(req('/stripe', { method: 'POST', body, headers }), env);
    assert.equal(r.status, 400, `${what} was let in`);
    assert.equal((await r.json()).error, 'not stripe', `${what} was refused for the wrong reason`);
  }
  assert.equal(await env.BOX.get('ev:evt_forged'), null, 'a forgery was marked handled');
  assert.deepEqual([...env.BOX._m.keys()], [], 'a forgery wrote to the club');
  assert.equal(seen.length, 0, 'a forgery was carried as far as stripe');
});

test('a webhook the club could not answer is left for stripe to send again', async (t) => {
  const env = clubEnv();
  stripe(t, () => new Response('{}', { status: 500 }));
  const r = await worker.fetch(await signed(env, {
    type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc' } },
  }, T, 'evt_outage'), env);
  assert.equal(r.status, 500, 'a stripe outage swallowed a membership');
  assert.equal(await env.BOX.get('ev:evt_outage'), null, 'and it was marked handled anyway');
});

test('a payment the club could not read yet is not marked handled and never lost', async (t) => {
  // The dangerous refusals are the ones that are ours. A restricted key without
  // the subscriptions scope returns a session whose subscription is a bare id,
  // and a subscription can be a second away from active. If those were filed as
  // handled, Stripe would stop sending, and a real payment would sit at Stripe
  // with no membership behind it and nothing to notice.
  const cases = [
    ['no-subscription', { subscription: 'sub_1' }],
    ['status', { subscription: { ...(await session()).subscription, status: 'incomplete' } }],
  ];
  for (const [reason, over] of cases) {
    const env = clubEnv();
    stripe(t, async () => session(over));
    const id = `evt_${reason}`;
    const r = await worker.fetch(await signed(env, {
      type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc' } },
    }, T, id), env);
    assert.equal(r.status, 500, `${reason} was answered as handled`);
    assert.equal(await env.BOX.get(`ev:${id}`), null, `${reason} consumed the event id`);
  }

  // and a session that genuinely is not ours to provision is filed, not retried
  const env = clubEnv();
  stripe(t, async () => session({ mode: 'payment' }));
  const r = await worker.fetch(await signed(env, {
    type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc' } },
  }, T, 'evt_notours'), env);
  assert.equal(r.status, 200);
  assert.equal(await env.BOX.get('ev:evt_notours'), '1', 'stripe will resend this for three days');
});

test('an event id is remembered as long as a person can resend it', async (t) => {
  // Automatic retries run three days; a person can resend by hand for thirty,
  // and Stripe keeps events retrievable that long. A marker that expires first
  // lets a resent delivery be handled a second time.
  const env = clubEnv();
  stripe(t, async () => session());
  const real = Date.now;
  t.after(() => { Date.now = real; });
  await worker.fetch(await signed(env, {
    type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc' } },
  }, T, 'evt_kept'), env);
  assert.equal(await env.BOX.get('ev:evt_kept'), '1');

  Date.now = () => real() + 20 * 24 * 3600 * 1000;
  assert.equal(await env.BOX.get('ev:evt_kept'), '1', 'twenty days on, and it has been forgotten');
  Date.now = () => real() + 31 * 24 * 3600 * 1000;
  assert.equal(await env.BOX.get('ev:evt_kept'), null, 'and it is not kept forever either');
});

test('a mint secret that has changed underneath the club stops it minting', async (t) => {
  // There is no rollback for this and no loud failure either: a new mint secret
  // re-keys every member at once, their stored key stops resolving, and a
  // recovery hands them a different key over an empty vault. So the first
  // membership leaves a fingerprint, and a club that no longer matches it
  // refuses rather than starting a second, parallel membership list.
  const env = clubEnv();
  stripe(t, async () => session());
  const first = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
  assert.equal(first.status, 200);
  const key = (await first.json()).key;

  const changed = { ...env, MINT_SECRET: '1'.repeat(64) };
  const after = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), changed);
  assert.equal(after.status, 503, 'a changed mint quietly minted a second membership');
  const minted = [...env.BOX._m.keys()].filter(k => k.startsWith('member:'));
  assert.deepEqual(minted, [`member:${key}`], 'and it left a second member behind');

  // the club that still holds the right secret is untouched
  assert.equal((await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env)).status, 200);
});

test('a price that changed does not lock an older member out of their own key', async (t) => {
  // A Stripe Price cannot be edited, so changing what a membership costs means
  // a new id. A member who paid at the old one, lost their key and still holds
  // their join secret must not be refused at the door for a price change they
  // had nothing to do with.
  const env = clubEnv({ STRIPE_PRICE: 'price_this_year', STRIPE_PRICE_ALSO: PRICE });
  stripe(t, async () => session());
  const r = await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), env);
  assert.equal(r.status, 200, 'last year’s member was locked out by this year’s price');
  assert.ok(isKey((await r.json()).key));

  // and a price that was never sold at is still refused
  const strict = clubEnv({ STRIPE_PRICE: 'price_this_year' });
  assert.equal((await worker.fetch(knock({ session: 'cs_test_abc', secret: SECRET }), strict)).status, 403);
});

// ---------- renewals, lapses, and the order they arrive in ----------

async function memberFor(env, over = {}) {
  const key = await mintKeyFor('sub_1', env.MINT_SECRET);
  await env.BOX.put(`member:${key}`, JSON.stringify({
    sub: 'sub_1', cus: 'cus_1', until: 1_000_000_000, standing: 'good', seq: 1000, ...over,
  }));
  await env.BOX.put('sub:sub_1', key);
  return key;
}

test('a cancellation that is reversed stops being announced', async (t) => {
  const env = clubEnv();
  stripe(t, async () => ({}));
  const key = await memberFor(env);

  await worker.fetch(await signed(env, {
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'active', cancel_at_period_end: true, current_period_end: 2_000_000_000 } },
  }, T - 60), env);
  assert.equal((await env.BOX.get(`member:${key}`, 'json')).leaving, true);

  await worker.fetch(await signed(env, {
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'active', cancel_at_period_end: false, current_period_end: 2_000_000_000 } },
  }, T - 30), env);
  assert.equal((await env.BOX.get(`member:${key}`, 'json')).leaving, false,
    'the club went on telling a paying member they were on their way out');
});

test('an event that arrives late may not undo one that arrived first', async (t) => {
  const env = clubEnv();
  stripe(t, async () => ({}));
  const key = await memberFor(env);

  // the cancellation is made second and delivered first
  await worker.fetch(await signed(env, {
    type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } },
  }, T - 30), env);
  assert.equal((await env.BOX.get(`member:${key}`, 'json')).standing, 'left');

  // ...and now the renewal that was made before it turns up
  await worker.fetch(await signed(env, {
    type: 'invoice.paid',
    data: { object: { subscription: 'sub_1', lines: { data: [{ period: { end: 2_100_000_000 } }] } } },
  }, T - 120), env);
  const m = await env.BOX.get(`member:${key}`, 'json');
  assert.equal(m.standing, 'left', 'a stale event raised a membership from the dead');
  assert.equal(m.until, 2_100_000_000, 'and a period end further out is still information');
});

test('same-second Stripe snapshots resolve fail-closed regardless of delivery order', async (t) => {
  stripe(t, async () => session());
  const pairs = [
    [
      { type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } },
      { type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc' } } },
      'left',
    ],
    [
      { type: 'customer.subscription.updated', data: { object: {
        id: 'sub_1', status: 'unpaid', cancel_at_period_end: false, current_period_end: 2_000_000_000,
      } } },
      { type: 'invoice.paid', data: { object: {
        subscription: 'sub_1', lines: { data: [{ period: { end: 2_100_000_000 } }] },
      } } },
      'held',
    ],
  ];

  let nth = 0;
  for (const [closed, opened, expected] of pairs) {
    for (const order of [[closed, opened], [opened, closed]]) {
      const env = clubEnv();
      const key = await memberFor(env);
      for (const ev of order) {
        const response = await worker.fetch(await signed(env, ev, T, `evt_equal_${++nth}`), env);
        assert.equal(response.status, 200);
      }
      assert.equal((await env.BOX.get(`member:${key}`, 'json')).standing, expected);
    }
  }
});

test('member authorization fails closed when its subscription authority is unavailable', async () => {
  for (const binding of [undefined, {
    idFromName: value => value,
    get: () => ({ fetch: async () => { throw new Error('durable storage unavailable'); } }),
  }]) {
    const env = clubEnv();
    const key = await memberFor(env);
    env.SUBSCRIPTIONS = binding;
    const response = await worker.fetch(req('/membership', {
      headers: { authorization: `Bearer ${key}` },
    }), env);
    assert.equal(response.status, 503, 'the KV mirror authenticated while the authority was unreachable');
  }
});

test('public payment bodies are metered before parsing and bounded while streaming', async () => {
  const refused = {
    idFromName: value => value,
    get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: false })) }),
  };
  for (const path of ['/checkout', '/door']) {
    const limited = clubEnv({ METER: refused });
    const rate = await worker.fetch(req(path, { method: 'POST', body: '{' }), limited);
    assert.equal(rate.status, 429, `${path} parsed an attacker-controlled body before charging its attempt`);

    const large = await worker.fetch(req(path, {
      method: 'POST', body: new Uint8Array(REQUEST_LIMITS.publicJson + 1),
    }), clubEnv());
    assert.equal(large.status, 413, `${path} buffered a body beyond its public limit`);
  }

  const webhook = await worker.fetch(req('/stripe', {
    method: 'POST', body: new Uint8Array(REQUEST_LIMITS.stripeWebhook + 1),
  }), clubEnv());
  assert.equal(webhook.status, 413, 'the signature path buffered an unbounded delivery');
});

test('what stripe says about a subscription is what the standing says', () => {
  const now = 1_000_000;
  const sub = over => ({ id: 'sub_1', current_period_end: now + 3600, ...over });
  assert.equal(patchFor(sub({ status: 'active' })).standing, 'good');
  assert.equal(patchFor(sub({ status: 'trialing' })).standing, 'good');
  assert.equal(patchFor(sub({ status: 'past_due' })).standing, 'good', 'the grace is what past_due is for');
  assert.equal(patchFor(sub({ status: 'unpaid' })).standing, 'held');
  assert.equal(patchFor(sub({ status: 'paused' })).standing, 'held');
  assert.equal(patchFor(sub({ status: 'canceled' })).standing, 'left');
  assert.equal(patchFor(sub({ status: 'incomplete_expired' })).standing, 'left');

  // a held membership is lapsed even with paid days left on it: those days
  // were bought by a payment stripe has since reversed or suspended
  assert.equal(standingOf({ until: now + 3600, standing: 'held' }, now), 'lapsed');
  assert.equal(standingOf({ until: now + 3600, standing: 'good' }, now), 'good');
});

// ---------- the way out ----------

test('leaving opens a portal for this membership and no other', async (t) => {
  const env = clubEnv();
  const seen = stripe(t, async () => ({ url: 'https://billing.stripe.com/p/session/abc' }));
  const key = await memberFor(env);

  const r = await worker.fetch(req('/portal', { method: 'POST', headers: { authorization: `Bearer ${key}` } }), env);
  assert.equal(r.status, 200);
  assert.match((await r.json()).url, /^https:\/\/billing\.stripe\.com\//);
  const form = new URLSearchParams(seen[0].body);
  assert.equal(form.get('customer'), 'cus_1', 'the portal was opened for somebody else');
  assert.equal(form.get('return_url'), 'https://resonate.select/?club=back');

  // a membership from before there was a billing account on file says so
  // rather than opening somebody else's portal
  const older = await mintKeyFor('sub_old', env.MINT_SECRET);
  await env.BOX.put(`member:${older}`, JSON.stringify({ sub: 'sub_old', until: 2_000_000_000, standing: 'good' }));
  const none = await worker.fetch(req('/portal', { method: 'POST', headers: { authorization: `Bearer ${older}` } }), env);
  assert.equal(none.status, 409);

  const anon = await worker.fetch(req('/portal', { method: 'POST' }), env);
  assert.equal(anon.status, 401);
});

// ---------- the edges ----------

test('one origin asks and one origin answers', async (t) => {
  stripe(t, async () => ({}));
  const env = clubEnv();
  const ask = origin => worker.fetch(req('/membership', { method: 'OPTIONS', headers: { origin } }), env);

  const mine = await ask('https://resonate.select');
  assert.equal(mine.headers.get('access-control-allow-origin'), 'https://resonate.select');
  assert.equal(mine.headers.get('vary'), 'Origin', 'a cache that does not vary hands one origin another’s answer');

  for (const stranger of ['https://resonate.select.evil.example', 'http://localhost:5178', 'null']) {
    const r = await ask(stranger);
    assert.equal(r.headers.get('access-control-allow-origin'), null, `${stranger} was let in`);
  }
});

test('a member’s answers may not be held in a cache', async (t) => {
  const env = clubEnv();
  stripe(t, async () => ({}));
  const key = await memberFor(env);
  const r = await worker.fetch(req('/membership', { headers: { authorization: `Bearer ${key}` } }), env);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('the attempts are counted, and the counting is not the club', async (t) => {
  stripe(t, async () => ({ id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/x' }));
  const env = clubEnv({ METER: durableNamespace('Meter') });
  const commitment = await commitmentOf(SECRET);
  const press = () => worker.fetch(req('/checkout', {
    method: 'POST',
    body: JSON.stringify({ claim: commitment }),
    headers: { 'cf-connecting-ip': '198.51.100.7' },
  }), env);

  let refused = 0;
  for (let i = 0; i < 12; i++) if ((await press()).status === 429) refused++;
  assert.ok(refused > 0, 'twelve sessions in a row, all made, all costing us an object at stripe');

  // another caller is not made to pay for the first one's appetite
  const elsewhere = await worker.fetch(req('/checkout', {
    method: 'POST',
    body: JSON.stringify({ claim: commitment }),
    headers: { 'cf-connecting-ip': '203.0.113.9' },
  }), env);
  assert.equal(elsewhere.status, 200, 'one caller filled the bucket for everyone');

  // and a meter that is broken is not a club that is shut
  const broken = clubEnv({ METER: { idFromName: () => 'x', get: () => ({ fetch: () => { throw new Error('gone'); } }) } });
  assert.equal((await worker.fetch(req('/checkout', { method: 'POST', body: JSON.stringify({ claim: commitment }) }), broken)).status, 200);
});

test('the desk is asked in the form stripe reads, and not in json', async (t) => {
  const seen = stripe(t, async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/x' }));
  await createCheckout({ secret: 'sk_test', price: PRICE, commitment: await commitmentOf(SECRET), site: 'https://resonate.select' });
  assert.equal(seen[0].headers['content-type'], 'application/x-www-form-urlencoded');
  assert.match(seen[0].headers.authorization, /^Bearer sk_test$/);
});

test('the desk says which mode it is in, so the app can be held to its word', async () => {
  // `TESTING` in js/club.js tells a person, in the moment before they type a
  // card, that no money changes hands. That sentence is true only if the secret
  // set on this worker by hand is a test key, and until this route the app had
  // no way to ask. The two facts lived apart: one in git, one in
  // `wrangler secret put`, and nothing in the suite or the smoke walk could see
  // the second one.
  //
  // The failure runs one way. `admits` already refuses a test session against a
  // live desk, so somebody who obeys the app and types a test card is turned
  // away. Somebody who types a real card produces a live session, which passes
  // every check here, and is charged a year having just read that nothing is
  // charged. So the desk is asked outright.
  const sandbox = await worker.fetch(req('/desk'), clubEnv());
  assert.equal(sandbox.status, 200);
  const said = await sandbox.json();
  assert.equal(said.live, false, 'a sandbox key was reported as a desk taking money');
  assert.equal(said.price, PRICE, 'the desk would not say which price it sells at');
  assert.equal(said.ready, true);

  // and the other way round, which is the answer that must never be guessed
  const live = await worker.fetch(req('/desk'), clubEnv({ STRIPE_SECRET: 'rk_live_9' }));
  assert.equal((await live.json()).live, true, 'a live key was reported as a sandbox');

  // A desk with no secret at all is not a sandbox and not live. It is
  // unconfigured, and saying so is the one thing club/src/stripe.js:25 says
  // cannot be told from a refused card from outside.
  const bare = await (await worker.fetch(req('/desk'), clubEnv({ STRIPE_SECRET: '' }))).json();
  assert.equal(bare.ready, false, 'a club missing its secret answered like a working one');

  // nothing here is a member's, and nothing here needs a key
  assert.equal((await worker.fetch(req('/desk'), clubEnv())).headers.get('cache-control'), 'no-store');
});
