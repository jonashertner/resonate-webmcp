# The envelope, specified

This is the complete wire format and protocol of the travellers club, written
so that a skeptical reader can verify every claim against the code and the
bytes. The implementation is js/club.js on the client and club/src/worker.js
on the server. Nothing here is custom cryptography: key derivation and
authenticated encryption use WebCrypto and, for Argon2id, the vendored
hash-wasm library. Its digest is committed at vendor/argon2/SHA256SUMS, the
page loads it under a subresource integrity hash, and every pull request and
every push to `main` re-checks the digest before the site can deploy.

## 1. Vocabulary

A **member** holds a **key** (`tc_` and twenty-some crockford characters),
minted by the door from a paid Stripe checkout session, exactly once per
subscription. A **claim** is the hash of a secret the joining device keeps, and
is what lets that device, and only that device, be told its key a second time.
A **phrase** is the member's sealing passphrase; it never leaves a device. An
**envelope** is the sealed atlas. The **vault** is the club's storage for one
member: the current envelope and the **one before** it. **seq** is a monotonic
count inside the envelope. A **revision** is the club's opaque name for the
envelope it currently holds, and is what a seal must name to replace it.

## 2. Envelope byte layout

Second form, written today:

```
offset  size  field
0       5     magic "rsnt2"
5       1     kdfId       1 = PBKDF2-SHA256, 2 = Argon2id
6       4     p0 u32le    kdfId 1: iterations · kdfId 2: memory KiB
10      1     p1          kdfId 2: passes (t), else 0
11      1     p2          kdfId 2: lanes (p), else 0
12      8     kid8        first 8 bytes of SHA-256("tc:" + key), zeros if unbound
20      16    salt        random per seal
36      12    iv          random per seal
48      ...   ciphertext  AES-GCM-256, 16-byte tag included
```

First form, read forever, written never (sealed before 2026-08-08):

```
"rsnt1" | salt16 | iv12 | ciphertext     PBKDF2-SHA256, 310000 iterations
```

## 3. Key derivation

The phrase is NFC-normalized, then:

- **kdfId 2, Argon2id** (write default when the vendored library is present
  and this device can run it): memory p0 KiB, passes p1, lanes p2, output 32
  bytes. Written today with m = 65536 KiB, t = 3, p = 1, per OWASP's first
  recommendation.
- **kdfId 1, PBKDF2-SHA256** (write fallback, and all rsnt1 envelopes):
  p0 iterations. Written today with 600000; rsnt1 envelopes carry 310000.
  A device whose WebAssembly will not run Argon2id seals in this dialect
  rather than failing, and the club room names the dialect each seal used.

Read-side bounds, refused as `not-an-envelope` outside them, so a hostile
header cannot spend the reader's memory or time: kdfId 1 iterations in
[100000, 5000000]; kdfId 2 memory in [8192, 262144] KiB, passes in [1, 10],
lanes in [1, 4].

Raising the write parameters is a one-line change; old envelopes keep opening
because the header, not the code, says how they were sealed.

## 4. Authenticated encryption

AES-GCM with a 256-bit key, 12-byte iv, 16-byte tag. For rsnt2, the
additional authenticated data (AAD) is the first 20 header bytes followed by
the UTF-8 bytes of the membership key the envelope is bound to (empty when
unbound). Consequences:

- KDF parameters cannot be quietly downgraded: a modified header fails the tag.
- An envelope bound to one membership cannot be replayed into another: the
  binding fails before decryption with `sealed-for-another-key` (via kid8),
  and would fail the tag even if kid8 were forged.

What the AAD deliberately does not bind: which vault slot the envelope sits in
(current or previous), the server's stored metadata (size, sealed-at), and
membership standing. rsnt1 envelopes carry no AAD.

## 5. Error taxonomy

`not-an-envelope` (wrong magic, an rsnt2 buffer under 49 bytes, an rsnt1
buffer under 49 bytes, or an out-of-bounds header) ·
`this-device-cannot-open-it` (an Argon2id envelope on a device without the
library, or one whose WebAssembly refuses to run: the envelope is intact and
another device opens it) ·
`sealed-for-another-key` (kid8 mismatch under a bound read) ·
`wrong-phrase` (authentication failure; also any tampering of salt, iv,
ciphertext, or header, and any rsnt1 buffer of 49 bytes or more that is
nonetheless truncated).

Those four are the reader's. The wire has its own, and every one of them is a
status code with a sentence beside it:

```
400  unreadable json; a session id that is not one; a commitment that is not
     sixty-four lowercase hex characters; a secret that is not thirty-two;
     if-none-match with anything but a bare star; an envelope under 24 bytes
401  no key, or a key the club does not know
402  a lapsed membership sealing a new envelope
403  a checkout session this club will not admit, for any of the reasons in
     section 9, including a commitment that is somebody else's
404  an empty vault, either slot; any other path
409  a membership with no billing account on file, asking for the way out
412  a seal naming a revision the vault no longer holds, or a creating seal
     into a vault that is not empty (section 10)
413  an envelope over 16000000 bytes
428  a seal naming no revision at all
429  too many attempts from one caller at a door that answers before anyone
     is a member (section 9)
500  a webhook the club could not finish handling, so that Stripe sends it
     again
503  the club cannot reach its payment desk: a missing secret, a rejected
     key, or Stripe itself. never a refused payment
```

## 6. The wrapper and seq

The plaintext is JSON: `{ v: 2, seq, sealedAt, atlas }`. Readers tolerate a
missing `v` (older wrappers) and a bare atlas (the oldest). `seq` sits inside
the authenticated ciphertext, so the server cannot alter it.

The sync refuses to write in exactly three cases, verbatim from the client:

1. The vault answers empty but this device has sealed before
   (`syncGuard(false, lastSeq > 0)`): a stale edge or a hollowed vault is
   never sealed over.
2. The vault returns an envelope with `seq` lower than this device has seen:
   an older envelope is never sealed over.
3. The device refuses the merge (storage rollback): the poorer atlas is never
   sealed over the richer envelope.

Otherwise the client merges additively, seals `max(remoteSeq, lastSeq) + 1`,
and records the new seq only after the server acknowledges the write.

Those three are the client's own, decided before anything is sent. A fourth is
the club's, decided at the moment of writing: a seal that names an envelope the
vault no longer holds is refused with 412, and the client reads again, merges
again, and seals over what it has now seen (section 10).

## 7. Burn

`DELETE /vault` first removes the readable head and atomically moves the current
and previous R2 object ids into a durable tombstone. It answers `{ gone: true }`
only after R2 confirms deletion. If collection fails it answers 202 with
`{ gone: false, pending: true }`; an alarm retains the ids and retry count and
tries again with exponential delays capped at one day, without a maximum number
of attempts. Calling delete again joins the same idempotent collection.

After confirmed deletion the client applies `burnPatch()`: seq returns to 0 and
the last-sealed time clears, so an empty vault is sealable again. The membership
key survives a burn; only "forget the key on this device" removes it locally.

## 8. The envelope before

Every successful seal demotes the previous current envelope to the `prev`
slot; the slot holds exactly one. `GET /vault?prev=1` returns it, and carries
no ETag: the slot before is read and never written, so a revision naming it
would name a thing no PUT accepts. Restoring from it merges additively into
the device and never deletes; nothing is sealed until the member syncs again.
This is the deliberate, member-initiated form of rollback; the seq guard exists
to refuse the involuntary form.

## 9. The join: a commitment before the payment, a secret after it

The door used to open for whoever held the checkout session id. That made the
Stripe receipt a credential: a session id in a browser history, a screenshot or
a support thread was a way into a stranger's backup, once. The binding is now
made before the payment rather than after it.

Before it asks for anything, the device mints a **join secret**: sixteen random
bytes in lowercase hex, kept in local storage under `resonate.club.join.v1`
alongside the session it began, and never sent. What travels first is the
**commitment**

```
commitment = lowercase hex of SHA-256( UTF-8( "tc-join:" + secret ) )
```

sixty-four characters, which opens nothing.

```
POST /checkout   { "claim": "<64 hex commitment>" }
     200         { "session": "cs_…", "url": "https://checkout.stripe.com/…" }
     400         not a commitment
     429         too many, too quickly
     503         the club cannot reach its payment desk
```

The session is created by the worker, never by a link: one Price id, quantity
one, card only, `adaptive_pricing[enabled]=false`, promotion codes off, the API
version pinned, and `Idempotency-Key: join:<commitment>` so a second press is
the same session. The commitment is written into `metadata[claim]` on the
session and on the subscription, where Stripe holds it. Adaptive Pricing cannot
be switched off on a Payment Link, which is why this is not one.

Coming back, the device presents the secret itself:

```
POST /door   { "session": "cs_…", "secret": "<32 hex>" }
     200     { "key": "tc_…", "until": <unix seconds> }
     200     { "key": "tc_…", "until": …, "again": true }   the membership existed
     400     not a session id, or not a secret
     403     the session is not admissible, or the commitment does not match
     429     too many, too quickly
     503     the club cannot reach its payment desk
```

The worker hashes the secret under the same label and compares it, in constant
time, to the commitment Stripe is holding. There is no window and no stored
claim record: the binding lives in the session's own metadata, so a device that
kept its secret can be handed its key a week or a year later. A stranger with
the session id computes nothing.

Every field is checked before a key is minted, and a refusal names none of them
outward: `livemode` matching the secret key's mode, `mode=subscription`,
`status=complete`, `payment_status=paid`, the commitment, an expanded
subscription in `active` or `trialing`, exactly one item, an admitted Price id,
quantity 1, currency CHF, interval one year, and a period end that exists. A
session paid at another price, in another currency, or for a quantity of nine
is refused although Stripe says it was paid.

More than one Price id may be admitted and only one is ever sold at. A Stripe
Price cannot be edited, so changing what a membership costs means creating a new
one; if the door admitted only the current id, a member who paid at the old
price, lost their key and still holds their join secret would be locked out of
their own vault by a change they had nothing to do with.

The membership key is not drawn at random. It is

```
key = mintKey( HMAC-SHA256( MINT_SECRET, "tc-key:" + subscriptionId )[0..16] )
```

so the webhook and the door, arriving in either order or at the same moment,
agree on it. KV cannot compare and swap; this removes the race rather than
narrowing it, and it is also how a key is recomputed for a member whose device
lost its secret.

## 9a. Where a membership begins

At the webhook, not on the return page. `checkout.session.completed` reads the
session back from Stripe expanded, applies the same admission checks, and
provisions. A member who paid and closed the tab is a member; the door only
collects what is already there. Every patch carries the moment its event was
made, so an event that arrives late cannot undo one that arrived first; a late
event may still raise a paid-until date, because that much is information rather
than history.

Those transitions are serialised in one SQLite-backed Durable Object per Stripe
subscription. It is authoritative for the membership state, key, ordering
cursor and revision. KV keeps a compatibility/read mirror and the reverse
subscription lookup, but it does not arbitrate event order.

Deliveries are deduplicated by event id for thirty days, not for the three that
Stripe's automatic retries run: an event stays retrievable and resendable by
hand for thirty, and a marker that expired first would let a resent delivery be
handled twice. The authoritative marker and its receipt time live in the same
subscription-object transaction as the state. Markers older than thirty days
are removed on the next transition; without another transition their stored
rows can remain longer, but no longer suppress a delivery. KV carries a second
thirty-day marker for compatibility. Three refusals are treated as "not yet"
rather than "no" and are left unfinished so Stripe delivers again: a
subscription that came back
unexpanded, which is a restricted key missing the Subscriptions scope rather
than a bad payment; a subscription not yet `active`; and a subscription with no
period end. Filing those as handled would strand a payment that really was made.

Subscription status maps to standing: `active`, `trialing` and `past_due` are
good, because the three day grace is what `past_due` is for; `unpaid` and
`paused` are held, which reads as lapsed even with paid days left on it;
`canceled` and `incomplete_expired` are left. `cancel_at_period_end` is written
every time and not only when true, so a cancellation that is reversed stops
being announced.

## 9b. Leaving

```
POST /portal   (Authorization: Bearer tc_…)
     200       { "url": "https://billing.stripe.com/…" }
     409       no billing account on file for this membership
     503       the club cannot reach its payment desk
```

A portal session is a credential, so it is opened on demand for the
authenticated membership and never published as a link. Deleting the backups
and forgetting the key stop no subscription, and the club room says so beside
the words that do it.

## 10. The revision, and two devices

`PUT /vault` used to overwrite whatever was there. Two devices could read the
same envelope, merge into their own atlas, and seal in turn; the second seal
erased the first, and the loser's records left no trace anywhere. The vault now
answers compare-and-swap.

Every seal mints a **revision**: sixteen random bytes in lowercase hex, held
in the membership's Durable Object and served as a strong ETag.

```
GET /vault        200, ETag: "<32 hex>", Cache-Control: no-store
PUT /vault        If-None-Match: *      the vault must be empty (the first seal)
                  If-Match: "<32 hex>"  the revision must be the current one
```

The envelope is served `no-store`, because an envelope read from a cache is an
envelope a device would then seal over with a revision that has already moved.
Exactly one of the two headers is required; If-Match is read first when both
are present. Neither present is 428. The condition failing is 412, and the
answer carries the current ETag when there is one, so the client knows there is
something to read. A successful PUT answers `{ bytes, at, rev }` and the new
ETag.

If-Match is compared as an exact string against `"<rev>"`. Two forms therefore
match nothing, on purpose: `W/"<rev>"`, because a weak comparison is no
comparison, and `If-Match: *`, because a star means "whatever is there", which
is a licence to overwrite, which is the thing the guard exists to refuse.

The revision is minted, not derived. An ETag computed from the envelope would
answer "is this still the envelope I hold a copy of" to anyone who asked;
random bytes answer nothing at all, and the club still never reads inside the
ciphertext to produce one. `DELETE /vault` removes the readable head before R2
collection and keeps the object ids in its retry tombstone until deletion is
confirmed, so a burned vault has no readable revision and the next seal creates.

## 11. Limits and standing

The vault accepts envelopes up to 16000000 bytes and refuses smaller than 24.
Membership standing is `good` until the paid-until date plus three days of
grace, then `lapsed`: a lapsed member still reads and deletes, but does not
seal. `left` follows a completed cancellation, and `held` reads as lapsed at
once, whatever the date, because Stripe has said the subscription is unpaid or
paused. Keys are 16 bytes in crockford base32, derived from the subscription id
under `MINT_SECRET`, so one subscription has exactly one key however many times
it is minted.

## 11a. The letterbox

A letter is sealed on the sender's device with RFC 9180 HPKE, mode `auth`,
DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM. The club stores the
bytes, their length, and the moment they arrived, and can decrypt none of it:
both public keys travelled in the introduction and the return, and neither has
ever been at the club.

**The wire format.** `rsntl` (5 bytes) | version (1) | kind (1) | message id
(16) | sent, big-endian milliseconds (8) | sender fingerprint (8) | recipient
fingerprint (8) | `enc`, the ephemeral public point, uncompressed (65) |
ciphertext. The first 47 bytes are the AAD; `enc` is not, because RFC 9180
binds it through `kem_context` rather than through additional data. The nonce
is derived from the key schedule and never transmitted. A fingerprint is the
first 8 bytes of SHA-256 over the raw public point. Kinds: 1 atlas, 2 folio,
3 ask, 4 thanks. The authenticated kind and the payload's own kind must agree.

**The address.** A box is at `route = mintKey(HMAC-SHA256(MINT_SECRET,
"letterbox:" || key))[3..]`: 26 crockford base32 characters, the same shape as
a membership key without its `tc_`. The club derives it from a key whenever a
member authenticates and cannot invert it, so a post names a box and never a
person. A posting capability is `<route>.<secret>`, the secret being 26 more of
the same alphabet, minted by the club and stored only as its SHA-256. A
capability is named to its owner by the first 8 characters of that hash.

**The doors.** All of them require a membership key, including posting: a
direct exchange needs both people in the club.

    GET    /letters                  { route, letters: [{id, bytes, at}], caps, count, bytes, until }
    POST   /letters/cap              { cap, id }
    DELETE /letters/cap/<capId>      { revoked: true }
    POST   /letters/post?id=<msgId>  x-cap: <cap>, body the letter -> { posted, waiting }
    GET    /letters/<msgId>          the bytes, with x-arrived-at
    DELETE /letters/<msgId>          { gone: true }
    DELETE /letters                  { gone: true }, capabilities included

A letter is at least 128 bytes, which is a 47-byte header, a 65-byte point and
a 16-byte tag: anything shorter cannot open and does not take a place in a box.
A capability is offered in the `x-cap` header and is never read from a query
string.

**Refusals.** 400 an address, a message id or a length of the wrong shape; 401 no
membership key; 402 the sender has lapsed; 403 the box is closed, or the
capability was withdrawn; 404 no box at that address, or no such letter; 409
that message id is already waiting; 413 the letter is over 262144 bytes; 429
too many posts, or the box already has 100 correspondents; 503 the club has no
letterbox configured; 507 the box holds 50 letters or 4194304 bytes.

**Retention: until burned.** No expiry. The caps are the only pressure on a
box, and a letter whose recipient was away for a fortnight is still theirs.

**Arrival, on the device.** The box is asked four seconds after boot, on return
to the foreground, on reconnect, and whenever the room is opened. A letter whose
id is already in this device's ledger is never fetched again; the ledger is
`resonate.post.v1`, it holds the last 200 ids and nothing else, and 200 is four
times what a box can hold at once. What is fetched is opened against the
sender's own public key, and refused unless the id inside the sealed header is
the id it was filed under. Its payload is normalised before any of it is shown,
and a letter that will not open is reported rather than allowed to block the
box: one bad letter never stops the rest from being read.

Throwing a letter away writes its id into the ledger **first**, and only then
tells the club to forget it. `DELETE /letters/<msgId>` frees that id for
reposting, so a delete this device did not record is a letter that can arrive a
second time with nothing left to recognise it by. A ledger write the browser
refuses aborts the delete, and the letter stays in the box to be met again.

Nothing of a letter's contents is written to this device until the person
adopts what is inside it. Until then the club's box is the durable copy, which
is what keeps up to four megabytes of somebody else's letters out of this
browser's own store.

**Lapse stops the exchange in both directions.** Outward at the sender's own
membership; inward at the recipient's box, which holds its own copy of the
paid-until. That copy is set, never raised, whenever the member authenticates,
and by the webhook when a subscription ends, so a box whose owner never comes
back is still shut. It is never written into a box that has not been opened,
so a member who has never used letters has no box at all. What is already in a
lapsed box stays readable and deletable until burned.

## 12. What the server stores

Each store holds only what it must.

**A SQLite-backed Durable Object per Stripe subscription** is authoritative for
the membership. Its state holds the membership key; subscription id; billing
account id; paid-until; standing; notice flag; newest-event sequence; ordering
cursor; and revision. Event rows hold a Stripe event id and receipt time for
thirty-day deduplication. They are removed on the first later transition after
their window, so a quiet subscription can retain an expired row longer.

**KV** is a compatibility and lookup mirror: `member:<key>` mirrors the
membership fields, `sub:<subscriptionId>` points back to the key, and
`ev:<stripeEventId>` mirrors a handled delivery with a thirty-day expiry. The
one authoritative value here is `mint:fp`, a fingerprint of the secret
membership keys are derived from, written once so a changed secret cannot
silently start a parallel membership list. No ciphertext is ever written here,
and no claim record exists: the device-to-payment binding is held in Stripe's
checkout metadata.

**A Durable Object per vault**, one per membership, holds the revision, the
random R2 object names for the current ciphertext and the one before it, their
byte counts and sealed-at times. During erasure it instead holds a tombstone of
the ids still to delete and the retry count, with an alarm until R2 confirms
collection. It holds no membership key, subscription or envelope. Comparison
and rotation happen inside one blocked section, so exactly one of two
simultaneous seals commits.

**R2** holds ciphertext under `vault/<forty-eight lowercase hex characters>`.
Names are never reused and objects are never overwritten, so an interrupted
seal leaves an object nobody points at rather than a damaged vault. Rotation
collects the object it evicts; burn collects the current and previous objects
named by its tombstone.

**A Durable Object per letterbox**, one per membership, at the derived route.
Its head holds letter count, total bytes, capability count and the recipient's
paid-until. Each letter row holds its message id, sealed bytes, length and
arrival time. Each capability row is keyed by SHA-256 of the bearer secret and
holds its first eight characters as the revocation id and the mint time; the
secret itself is not stored. It has never seen a membership key, and nothing in
the club maps a route back to a member. It accepts 128 through 262144 bytes per
letter, no more than 50 letters or 4194304 bytes total, and no more than 100
capabilities. Those caps are enforced inside a single blocked section, which is
what makes "the fifty-first is refused" true rather than likely.

**A Durable Object per hashed caller**, holding a count of attempts and the
moment it was last taken from. Four separate buckets, each named by a hash of
kind and caller address, allow 8 checkouts, 30 door openings, 30 unknown-key
requests and 120 letter posts per hour. The name never contains the address,
and an alarm deletes the object after two windows, which is two hours for all
four buckets.

Raw invocation logs are disabled. The worker emits deliberate operational
events with no request identifiers: an event name and, where needed, a reason
or outcome, webhook type, meter kind, repeated flag, or rounded vault size.
Cloudflare processes request metadata and those events as the network and
execution provider under its own policies; this repository configures no log
retention duration. The full adversarial accounting lives in THREATS.md at the
repository root, published on the site.
