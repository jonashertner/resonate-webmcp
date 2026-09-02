# Privacy

This is the document that says what is held about you, by whom, for how long,
and how to make it stop. It is meant to be read in full, which is why it is
short.

The technical claims behind it are
[answered question by question](THREATS.md), against the code as it stands,
and the sealing format is [specified in full](SPEC.md). Where this document
and the code disagree, the code is what is running and the disagreement is a
bug worth reporting.

## the short version

If you use the atlas without joining the club, we hold nothing about you at
all. There is no account, no sign-up, no analytics, no cookie set by this site
and no server of ours that your atlas ever reaches.

If you join the club, we hold the membership and sealed-backup records listed
below. If you use direct letters, a letterbox also holds ciphertext, delivery
metadata and hashed posting capabilities. The club sees the sender and
destination box together while it delivers a letter, although it stores no
sender-to-box map. Your name and your card are held by Stripe and never reach
us. The full storage, traffic, quota and retention inventory is further down.

## while this is a test

The club is not selling anything yet, and **no money changes hands**: the
payment side runs against Stripe's sandbox, so a card typed into it is a test
card and no real card is charged. What follows describes the club as it is
built, and it is accurate about what the code holds. What it cannot promise yet
is durability: a test membership and the backups behind it can be ended, reset
or wiped without notice. The exports under **your data** are free, and during this
period they are the copy that matters.

## who is responsible

Resonate Select.

There is no postal address to print here yet: nothing is incorporated and
nothing is being sold, and an invented address would be worse than the gap. It
goes here before the first franc is taken.

resonateselect@proton.me

That is the controller for the club, and the address for any request under
this document. There is no data protection officer, because a service of this
size is not required to appoint one and pretending otherwise would be
theatre.

## what stays on your device

Your atlas. Places, paths, folios, tags, voices, settings and snapshots all
live in your own browser's storage, on the machine you are reading this on.
They are not sent anywhere as you work, they are not backed up unless you join
the club and press the button, and clearing your browser's storage for this
site deletes them for good.

Browser-assistant access is off by default. In a browser that supports WebMCP,
one zero-data tool may open the dedicated access review before consent. It
accepts no input, returns no atlas data and cannot grant access. If you
explicitly press **Allow access**, an assistant provided by or through that
browser may use five tools to read the same non-private slice you could hand to a friend.
It may search that slice and open proposals on screen. It cannot save, delete,
publish or share through those tools; each change remains a press by you. The
tools are local page functions and send nothing to a Resonate server, but the
assistant or its provider may process or retain what it reads under their own
terms. Turning access off unregisters the five data tools and leaves only the
zero-data review tool. The exact fields and limits
are written in [the assistant contract](ASSISTANT-ACCESS.md).

A photograph dropped on the field is read for the point the camera wrote into
it and then let go. Nothing of the picture is written down, so there is
nothing of it to send.

## what the club holds, exactly

Per member, the membership and backup records are:

- the membership key
- the Stripe subscription id behind the payment
- the Stripe billing account id it belongs to, which is what opens the billing
  portal and so is what makes leaving possible
- a paid-until date
- the standing: in good standing, held, or ended
- a flag recording whether you have given notice
- the moment of the newest billing event we have applied, so that a late one
  cannot overwrite a newer state
- a reverse pointer from the Stripe subscription id to the membership key
- the sealed envelope and the one before it, each under a random R2 object name
- each envelope's size in bytes and sealed-at time
- the vault's current revision and its pointers to those two object names

The authoritative membership record is in one SQLite-backed Durable Object per
Stripe subscription. It holds the membership key, those membership fields, an
ordering cursor and revision, plus the id and receipt time of each Stripe event
still inside the thirty-day deduplication window. An expired event marker is
removed on the next transition, so it can remain stored beyond thirty days
while a subscription has no new event, but it no longer suppresses a delivery.

Cloudflare KV is a compatibility and lookup mirror, not the authority. It holds
the same membership under `member:<key>`, a `sub:<subscription id>` reverse
pointer, and a second handled-event marker that has a thirty-day KV expiry.
`mint:fp`, also in KV, is a fingerprint of the secret from which membership keys
are derived and has no timer.

The vault's revision, current and previous random R2 object names, sizes and
sealed-at times live in a separate Durable Object that has never seen an
envelope. The ciphertext lives in R2 under those random names.

A letterbox is created only when a member first uses letters. It is a Durable
Object named by a route derived one way from the membership key; the club stores
no route-to-member table. It holds:

- a head containing waiting-letter count, total bytes, capability count and the
  recipient's paid-until time
- for each waiting letter, its 32-character message id, sealed body, byte count
  and arrival time
- for each posting capability, SHA-256 of the bearer secret, its first eight
  characters as the revocation id, and the time it was minted. The secret itself
  is not stored

One letter must be at least 128 bytes and at most 262144 bytes. A box accepts at
most 50 waiting letters, 4194304 bytes in total and 100 posting capabilities.
Those limits are decided atomically inside the box.

The worker nevertheless sees a capability secret in transit when it mints it
and when a sender presents it to post. A post request also carries the sender's
membership credential, the destination route, the 32-character message id and
the sealed body. The worker can therefore connect that sender to that box for
the duration of delivery. It persists the letterbox record above, but no
sender-to-box history and no route-to-member map.

Four acts are rate limited per hash of `kind + request IP`: checkout at 8 per
hour, opening the payment door at 30 per hour, requests with an unknown
membership key at 30 per hour, and posting letters at 120 per hour. Each meter
holds the tokens left and a timestamp, and its alarm deletes the object two
hours after the last use. The IP itself is not stored. A missing or unavailable
meter fails open, so it creates no substitute record.

Raw Cloudflare Worker invocation logs are disabled. The code deliberately emits
small operational events instead: an event name and, where needed, a bounded
reason or outcome, webhook type, meter kind, repeated flag, or rounded vault
size. It does not put membership keys, session ids, routes, capabilities,
message ids or request bodies in those events. Cloudflare processes request
metadata and these events as the network and execution provider. This
repository sets no event-log retention period, so the Cloudflare account and
plan control it rather than a timer promised here.

## what we are never able to see

A place, a note, a path, a tag, a name, or your phrase.

Not because we have undertaken not to look, which would be worth very little,
but because the envelope is sealed on your device under a phrase that never
leaves it. There is no key on our side to produce, so there is nothing for a
support request, a subpoena or a mistake of ours to reach.

One thing follows from this that is worth stating plainly rather than leaving
for you to work out: **we cannot recover your data for you.** If you lose the
phrase, what we hold becomes permanently unreadable to everyone including us.
That is the same property, seen from the other side.

## who else is involved

Two parties process data on our instructions.

- **Cloudflare** runs the club: the worker, the KV store, the Durable Object
  and the R2 bucket. It sees each request's metadata at its edge and holds the
  ciphertext at rest.
- **Stripe** takes the payment. It holds your name, your card and the email
  you gave it, and maps them to the subscription id we hold. We can see, in
  Stripe's own dashboard, which subscription a name belongs to. We never
  receive your card.

Five more are spoken to by your browser rather than by us. We send them
nothing and receive nothing back about you.

- **GitHub Pages** serves this page, its code and its typefaces, and sees your
  address and each file it hands you, as any host does.
- **CARTO** serves the map tiles, so it sees roughly where you are looking.
- **Photon**, the OpenStreetMap typeahead run by komoot, answers the
  suggestions under the field as you type, from the third letter onward. It
  sees the letters you have typed, and when the field is zoomed in it also sees
  roughly where the field is looking, to about a kilometre. It is the party
  spoken to most often, and it is spoken to without you pressing anything.
- **Nominatim**, at OpenStreetMap, answers a place search when you press for
  it, and sees what you searched. It is also asked what stands at a point,
  which nobody presses for: it is sent the exact coordinates of a place you
  mark, of the spot you are standing on when you ask for it, of a photograph
  you drop on the field, and of the middle of a walk you import, at the moment
  you keep the thing. For a photograph and for standing here, that is often
  home.
- **Apple or Google Maps** receives a place's name and its point, and only at
  the moment you press directions for it.

And **Proton** carries the support mailbox, so anything you write to us is
held there.

An assistant you choose is not a processor selected by us. If you enable
browser-assistant access or hand one an assistant copy, you are disclosing the
reviewed fields to that assistant and its provider. Their privacy terms apply;
we do not receive that disclosure and cannot recall it.

The page's security policy bounds every address it may speak to. It is in the
source of the page and you can read it.

## why we are allowed to hold it

For the club: because you asked us to, and because holding it is how the thing
you bought works. In the language of the European regulation that is
performance of a contract, and for the small amount of security-related
processing it is our legitimate interest in running a service that is not
trivially abused.

For the free atlas: no basis is needed, because no processing by us happens.

We do not profile, we do not advertise, we do not sell anything to anyone, and
there is no automated decision-making of any kind.

## where the bytes sit

Your envelopes sit in Cloudflare R2, in a bucket created under Cloudflare's EU
jurisdictional restriction. Cloudflare documents that as a guarantee that
objects in the bucket are stored within the European Union. Read it as narrowly
as it is written: it is a statement about where stored objects sit, and not
about where requests are handled or where operational metadata and logs are
kept. Cloudflare, Inc. is a United States company and is our processor wherever
the bytes rest, so this is a guarantee about storage rather than the removal of
a transfer, and we would rather say so than let the word European do work it
has not earned.

Payments are processed by Stripe, which operates internationally, and the
support mailbox is at Proton in Switzerland.

## how long

Your envelopes are kept until you delete them, or until the club closes.
Nothing on our side deletes them on a timer, and a lapsed membership keeps
both its envelopes and its right to fetch and delete them. A delete first makes
both envelopes unreadable by removing the vault head and moves their object
names into a durable deletion tombstone. The club then asks R2 to delete them.
If R2 does not confirm, the API answers that erasure is pending and an alarm
retries with increasing delays, up to one day between attempts, for as long as
needed. The tombstone and ciphertext can therefore remain without a fixed
deadline after the request, but no vault read can reach them. After R2 confirms,
Cloudflare infrastructure may retain replicas under its own policies.

Waiting letters likewise have no expiry. Each remains until the recipient
deletes that letter or burns the whole box. A posting capability remains until
the recipient revokes it or burns the box. Burning removes the box head, every
letter and every capability. Lapse stops new letters but leaves existing ones
readable and deletable. A box that its member has never used is never created.

**Membership bookkeeping outlives the membership**, and that is worth stating
rather than leaving to be discovered. The key, the two Stripe identifiers, the
date, the standing, the notice flag and the sequence number are kept when a
membership ends and are not deleted on any timer. That is not an oversight: the
record is what tells your key from a stranger's, and it has to still be there
for you to fetch and delete your envelopes after you have left, which is the
right promised four paragraphs up. It is deleted when you ask, by hand, at the
address below.

Payment records at Stripe are kept for as long as accounting law requires,
which is longer than any of the above and is not ours to shorten.

The KV handled-Stripe-event mirror expires after thirty days. The authoritative
event marker stops deduplicating after thirty days and is removed during the
next subscription transition; without another transition its row can remain
longer. Rate-meter state expires two hours after its last use. The
operational-event retention described above is controlled by the Cloudflare
account because this repository sets no duration for it.

Support mail is kept until the matter is finished and then deleted.

## your rights, and how to use them

Write to resonateselect@proton.me from the address you paid with. You can ask
for a copy of what we hold, for a correction, for deletion, for a portable
copy, and you can object to processing.

Two of those have honest limits worth knowing before you ask.

**A copy of what we hold** is the list further up this page, in full and with
nothing held back. We can hand you the ciphertext along with it. We cannot
hand you the atlas inside it, because we cannot open it. The readable copy is
the one on your own device, and the app exports it in seven forms without
asking anything of you.

**Deletion** comes in two halves, and only one of them is yours to do.

Your envelopes you delete yourself, from inside the app, at any time and
without asking us, under **delete both backups**. A membership that has lapsed
or ended deletes as freely as one in good standing. That reaches both
envelopes, their sizes and the time of the last seal, and nothing else: the
membership key survives it, by design, so that you can back up again.

The API reports `gone: true` only after R2 confirms removal. It can instead
answer `202` with `pending: true`; then its durable tombstone keeps the object
names and retry count and the club continues retrying. Asking again is safe and
asks the same deletion to finish.

Individual letters disappear from the club when you keep or throw them away.
Revoking a correspondent deletes that posting-capability hash. Burning the
letterbox deletes all waiting letters, their metadata, its paid-until copy and
every capability. It does not delete the membership or its backup vault.

The membership bookkeeping needs a word to us, and it is then deleted by hand.
If you have lost the key and cannot reach your own vault, the envelopes are
deleted by hand too, as described in [the terms](TERMS.md).

If you think we have got this wrong, you can complain to a supervisory
authority: in Switzerland the Federal Data Protection and Information
Commissioner, and in the European Union or the United Kingdom the authority
where you live. We would rather you wrote to us first, but that is your choice
and not a condition.

## children

The club is not aimed at children and we do not knowingly hold anything about
one. There is no age check, because performing one would mean collecting more
about everybody than the service holds today.

## changes

A change that affects what is held about you reaches members at the address
they paid with before it applies. Corrections that do not, a clearer sentence
or a fixed address, are made when they are noticed. The current policy stays at
https://resonate.select/PRIVACY.md. Dated changes are public in the source
history at https://github.com/jonashertner/resonate-webmcp/commits/main/PRIVACY.md.
Write to resonateselect@proton.me for a copy or a question about a change.
