# The travellers club

The club keeps two things and knows almost nothing: a membership, which is a
key and "paid until when", and a vault, which is one sealed envelope per
member and the one before it.

The vault is three parts, and the split is the point. A Durable Object, one per
membership, holds the revision and the names of the two ciphertext objects, and
does the comparison and the rotation inside a single blocked section, so exactly
one of two simultaneous seals commits. R2 holds the ciphertext under names of
sixteen random bytes that are never reused. KV holds the memberships and never
a byte of an envelope. What that buys is that every way of dying during a seal
is harmless in the same direction: before the rotation, litter; during it,
nothing at all, because the rotation is one write of one value; after it, a
whole state whose answer was merely lost.

The envelope is sealed on the member's device before it travels. The phrase
never leaves that device. The club cannot open what it keeps. What it holds
about a member, in full: the key, the Stripe subscription id, the Stripe
billing account id so that leaving is possible, a paid-until date, the
standing, notice of cancellation, the moment of the newest Stripe event
applied, the envelope's size and the time it was last sealed, and the envelope
before it. No names, no
addresses, no request logs. If the worker disappears, every atlas keeps living
in its browser; only the backup goes quiet.

## What it serves

```
POST /checkout     a commitment becomes a checkout session, made here
POST /door         that session, once paid, becomes a key for the device that paid
POST /stripe       Stripe's webhook: memberships begin, renew, and lapse here
POST /portal       a billing portal session, for leaving
GET  /membership   good | lapsed | left, and until when
PUT  /vault        the sealed envelope, if-match the revision held
GET  /vault        the envelope back, and its revision. ?prev=1 for the one before
DELETE /vault      both envelopes, gone
```

A lapsed member still reads and deletes; only sealing anew asks for good
standing. Three days of grace follow every period, so a stumbling card does
not eat a backup.

The session is made here and not by a link, at one Price id, quantity one, card
only, with adaptive pricing refused by name and the API version pinned: a
Payment Link cannot refuse adaptive pricing, so a link saying CHF 48 shows a
visitor abroad a converted number and "one price, one currency" stops being
true. The joining device commits to a secret before it pays, the commitment
rides in the session's metadata, and the door hands the key to whoever can show
the secret behind it. A stranger holding the session id holds a number that
opens nothing, before the paying device knocks as well as after. The membership
begins at the webhook, so a payment whose success page never loads is still a
membership. The vault answers compare-and-swap: it names the envelope it holds
with an ETag, and a seal must say which envelope it is replacing, or it is
refused rather than obeyed. All of it is specified in SPEC.md.

## Opening the club

The steps, their order, and the four of them that have no rollback are in
[LAUNCH.md](LAUNCH.md) beside this file. The order is not the obvious one: the
webhook needs a url that does not exist until Cloudflare is done, the worker
needs a Price id that does not exist until Stripe is done, and the app must not
be able to sell anything until both work.

Two things from it are worth knowing before reading any of the code. `wrangler
deploy --dry-run` prints the bindings it actually resolved, and reading that
table is a step rather than a habit: a `[vars]` section written above the KV
declaration once turned the whole binding into an environment variable, and the
only symptom would have been a 500 on the first request from the first person
who ever paid. And `MINT_SECRET` is not a rotatable credential: every membership
key is derived from it, so setting a second one re-keys every member at once.
The worker keeps a fingerprint of it and refuses to mint if it has changed,
which makes that a loud outage instead of a silent catastrophe.

## Trying it without any of that

```bash
node club/mock.mjs        # the pretended club, port 5179
```

In the app, set `settings.clubUrl` to `http://localhost:5179` and press
**become a member** in the club room. The mock makes its own session, takes no
card, marks it paid and sends the browser home, exactly as the worker and Stripe
do between them. It speaks the same protocol, commitment and revision included,
so a client that works against it works against the club. It has two levers the
real club does not have: `POST /lapse` ends a membership, and `POST /die?at=…`
stops the next seal after the upload or after the rotation.

## Tests

```bash
node --test club/test/*.test.mjs
```

They hold the lines: keys mint into their own alphabet and one subscription has
exactly one of them; standing honours the period, the grace and what Stripe says
about the subscription; the webhook only listens to Stripe, reads both the old
field shapes and the basil ones, ignores a delivery it has already handled, and
refuses to let a late event undo a newer one; the session is made at one price
with adaptive pricing refused; the door opens only for the device that committed
to the payment and only on the exact thing we sell; a club that cannot reach
Stripe says so in its own words instead of blaming a card; and the vault keeps
exactly what it was given and refuses what is unsealed, too small, too large, or
sealed over an envelope the writer never read.

## The specification

The envelope's exact bytes, the KDF parameters and their bounds, the AAD
binding, the seq refusal rules, and the burn state transition live in
SPEC.md beside this file, published on the site as /SPEC.md. The adversarial
accounting is THREATS.md at the repository root, published as /THREATS.md.

## The honest sentences

Lose the phrase and the envelope is lost with it. Nobody can open it for a
member, and that is the point.

And: the club protects a member against losing their device, not against losing
our account. Both envelopes live in one Cloudflare account and are copied
nowhere else, because copying them to a second company would double what is held
about a member and double what a breach or a court order could reach, to insure
a failure the member can answer better than we can. The exports under **your data**
are that answer. This is a backup of a device, not an archive of record, and
THREATS.md question 17 says so at length.
