// stripe.js — the smallest possible acquaintance with Stripe.
//
// No SDK. Four things only: create a checkout session, ask about one, open a
// billing portal, and verify that a webhook truly came from Stripe. Money is
// Stripe's business; the club only ever learns "paid until when".
//
// Every call pins the API version. An account's default version moves when
// Stripe moves it, and a worker that reads `current_period_end` from wherever
// it happened to be last week is a worker whose renewals stop arriving on a
// morning nobody deployed anything.

import { sameString, TERMS } from './validate.js';

const API = 'https://api.stripe.com/v1';

// the version this worker was written against. the subscription's period end
// lives on the items here, and adaptive pricing can be refused per session.
export const API_VERSION = '2025-03-31.basil';

// One shape for every answer, because the difference between "Stripe refused
// this payment" and "the club cannot talk to Stripe" is the difference between
// a member's problem and ours, and the old code could not tell them apart: a
// missing secret produced a 401, a 401 produced null, and null produced the
// same 403 an unpaid session produced. A misconfigured club looked exactly
// like a refused card, from the outside and from a smoke test.
async function call(method, path, { secret, form, idempotencyKey, fetcher = fetch } = {}) {
  if (!secret) return { ok: false, status: 0, reason: 'no-secret', body: null };
  const headers = {
    authorization: `Bearer ${secret}`,
    'stripe-version': API_VERSION,
  };
  let body;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = form.toString();
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  let r;
  try { r = await fetcher(`${API}${path}`, { method, headers, body }); }
  catch { return { ok: false, status: 0, reason: 'unreachable', body: null }; }

  let parsed = null;
  try { parsed = await r.json(); } catch { parsed = null; }
  if (r.ok) return { ok: true, status: r.status, body: parsed };

  const reason = r.status === 401 || r.status === 403 ? 'not-allowed'
    : r.status === 404 ? 'missing'
      : r.status === 429 ? 'busy'
        : r.status >= 500 ? 'stripe-down'
          : 'refused';
  return { ok: false, status: r.status, reason, body: parsed };
}

// ours to fix, not the member's: these never come back as a refused payment
export const isOurFault = reason =>
  reason === 'no-secret' || reason === 'not-allowed' || reason === 'unreachable'
  || reason === 'stripe-down' || reason === 'busy';

export function fetchSession(id, secret, fetcher = fetch) {
  return call('GET', `/checkout/sessions/${encodeURIComponent(id)}?expand[]=subscription`,
    { secret, fetcher });
}

// The session, made here rather than in a dashboard.
//
// A Payment Link cannot do this job. Adaptive Pricing has been a built-in
// feature of Payment Links since April 2025 and cannot be switched off there,
// so a link that says CHF 48 shows a Canadian visitor a converted number in
// Canadian dollars, and "one price, one currency" stops being true the moment
// someone abroad presses it. A session created here refuses it by name.
//
// The commitment travels in metadata twice: on the session, which the door
// reads, and on the subscription, which is what is left after the session
// expires and the only place a recovery can look a year later.
export function createCheckout({ secret, price, commitment, site, fetcher = fetch }) {
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', price);
  form.set('line_items[0][quantity]', String(TERMS.quantity));
  // the currency is the price's own and is not restated here: a session that
  // names one is a session that can disagree with the price it names. what the
  // currency has to be is checked at the door, against the item Stripe returns.
  // card only: a delayed payment method settles days later, and a door that
  // opens on "processing" hands out a key for money that never arrives
  form.set('payment_method_types[0]', 'card');
  form.set('adaptive_pricing[enabled]', 'false');
  form.set('allow_promotion_codes', 'false');
  form.set('billing_address_collection', 'auto');
  form.set('success_url', `${site}/?club={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${site}/?club=none`);
  form.set('metadata[claim]', commitment);
  form.set('subscription_data[metadata][claim]', commitment);
  // a device that presses twice, or presses again after a lost answer, gets
  // the session it already has rather than a second one to abandon
  return call('POST', '/checkout/sessions', { secret, form, idempotencyKey: `join:${commitment}`, fetcher });
}

// Leaving, from the member's side.
//
// The two words under `leaving` in the club room delete backups and forget a
// key; neither stops a subscription, and only Stripe can. This is the door out,
// and it is opened on demand rather than published as a link, because a portal
// session is a credential and a link that is a credential is a link that gets
// pasted.
export function createPortal({ secret, customer, site, fetcher = fetch }) {
  const form = new URLSearchParams();
  form.set('customer', customer);
  form.set('return_url', `${site}/?club=back`);
  return call('POST', '/billing_portal/sessions', { secret, form, fetcher });
}

// stripe signs: HMAC-SHA256(`${t}.${body}`) with the webhook secret,
// delivered as "t=...,v1=...". five minutes of tolerance.
export async function verifyWebhook(body, sigHeader, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret) return false;
  const parts = Object.create(null);
  for (const kv of String(sigHeader || '').split(',')) {
    const [k, v] = kv.split('=');
    if (k === 't') parts.t = v;
    if (k === 'v1') (parts.v1 ??= []).push(v);
  }
  const t = parseInt(parts.t, 10);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > 300 || !parts.v1?.length) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // Keep the request bytes byte-for-byte.  Decoding and re-encoding before
  // verification can change malformed UTF-8, even though Stripe signed the
  // original octets.  Strings remain accepted for the small unit helpers.
  const raw = typeof body === 'string' ? new TextEncoder().encode(body)
    : body instanceof Uint8Array ? body
      : new Uint8Array(body);
  const prefix = new TextEncoder().encode(`${parts.t}.`);
  const signed = new Uint8Array(prefix.byteLength + raw.byteLength);
  signed.set(prefix);
  signed.set(raw, prefix.byteLength);
  const mac = await crypto.subtle.sign('HMAC', key, signed);
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return parts.v1.some(v => sameString(v, hex));
}
