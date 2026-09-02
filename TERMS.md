# The terms

The atlas is free and speaks to no server of ours. These terms cover the one
thing that is sold: membership of the travellers club, which adds an encrypted
backup of your atlas to a server that cannot read it.

If you have not joined the club, nothing here applies to you. Nothing here
takes away a right your own country's law gives you and does not let you sign
away.

The words used below mean what they mean elsewhere on this site. How the
locking works is [specified in full](SPEC.md). What each party can see is
[answered question by question](THREATS.md). How to report a weakness is
[on its own page](SECURITY.md). What we do with the little we hold is
[the privacy notice](PRIVACY.md).

## while this is a test

Read this first, because everything after it is written in a tense the club has
not reached.

The club is not selling anything yet. It is open to a few people who were asked
directly, the payment side runs against Stripe's sandbox, and **no money changes
hands**: a card typed into it is a test card, no real card is charged, and
nothing below about price, renewal, lapsing or refunds has taken effect for
anybody.

What that costs you is worth knowing before you put an atlas in it. A test
membership can be ended, reset or wiped without notice, and the backups behind
it go with it. Nothing on our side is durable yet. The exports under **your data**
are free and always available, and during this period they are the copy that
matters: treat the club as a thing being tried and not as the place the only
copy lives.

Letters are newer still. The sealing is [specified in full](SPEC.md) and checked
against the published test vectors of the standard it implements, and it has not
yet been reviewed by anybody outside this project. That review is owed before
the club is offered to strangers. Until it is done, a letter is as private as
the code is correct, and nobody outside has checked the code.

The rest of this document is written as though the door were open, because it
will be, and because a document rewritten on the day money starts moving is a
document nobody has read. When that day comes this section is deleted, and its
deletion is the announcement.

## who sells this

Resonate Select.

There is no postal address to print here yet. Nothing is incorporated and
nothing is being sold, and an address invented to fill a heading would be worse
than the gap that is left. It goes here before the first franc is taken, and not
after.

Not registered for Swiss value added tax, being below the turnover that requires
it. Some countries tax a digital service from the first sale whatever the size
of the seller; where that applies it is inside the figure quoted and is never
added at the end.

Write to resonateselect@proton.me about anything in this document: a payment,
a membership, a refund, a deletion, or a key that never arrived. That address
is read by a person. Weaknesses in the code go to
[the reporting channel](SECURITY.md) instead, which is watched for that
purpose.

## what is sold

One thing, and it is worth being exact about its shape because the shape is
the product.

A membership buys room on our server for two sealed envelopes: the current one
and the one before it. An envelope is your atlas, encrypted on your own device
under a phrase that never leaves it, before it travels. We hold ciphertext and
the small amount of bookkeeping a subscription needs. We cannot read your
places, your notes, your paths, or the byline inside your atlas, and no support
request, court order or mistake of ours changes that, because the key that
opens an envelope is made from your phrase and does not exist on our side to be
produced.

Your own name is the exception, and it is better said here than discovered
later. It sits at Stripe, we operate that account, and we can see there which
subscription a name belongs to. Our own storage maps that subscription to a key
and the key to a backup. So we can find which backup belongs to a paying
person, using nothing but our own credentials. What that never yields is a way
into the backup itself. It is also how a backup is deleted by hand for someone
who has lost their key, which is why the chain exists at all.

An envelope may be up to 16,000,000 bytes. A larger one is refused by the club
rather than by your device, so it travels before it is turned away. Nothing of
it is kept, the backup already stored is left exactly as it was, and the app
says the atlas is too large for one backup.

Nothing warns you as you approach that. The app shows the size of your last
backup in the club room and you can watch it, but there is no alarm, and the
first sign of trouble is a save that will not go. If you reach it, the club has
no larger size to sell you and the year already paid for is not refunded, so
what is left is to export what you have, which is free and always available,
and to decide what the backup should carry.

## what is not sold

**This is a backup, not synchronisation.** What comes home is merged in: it
adds what your atlas lacks and changes nothing it already holds. It carries no
deletions, so a place removed on one device returns from an envelope sealed on
another. There is no ordering of edits between devices, no resolution of a
conflict, and no moment at which two devices are known to agree.

**This is not an archive of record.** Both envelopes live in a single
Cloudflare account and are copied nowhere else. The club protects you against
losing your device. It does not protect you against losing our account, to a
mistake of ours, a suspension, a bill unpaid, or an outage that does not end.
That is a deliberate limit, and the reasoning is
[question seventeen of the threat model](THREATS.md). The exports under
**your data** are the copy nobody can take away, and they cost nothing.

**This is not storage you can point anything else at.** There is no API for
you to build on, no guarantee of any particular endpoint, and no undertaking
that the format will not change. The format that is published is published so
that you can verify it, not so that you can depend on it.

## the price

CHF 48 a year. Swiss francs only, and the only currency the club will accept.
The figure is tax-inclusive at the standard rate: there is nothing to add at
the end.

It renews automatically, once a year, on the anniversary of your payment,
until you end it. Your card is charged the same figure each time. If the price
changes, the change reaches you before a renewal, and a renewal you were not
told about at the old price is charged at the old price.

We do not localise the price. If your card is issued outside Switzerland your
bank converts francs at its own rate and may add its own fee, and neither the
rate nor the fee is ours or is known to us.

There is no trial, no discount code, and no plan other than this one. Cards
only.

## how you end it

Through the billing portal, reachable from the club room inside the app. The
membership then runs to the end of the year you have paid for and stops. It is
not cut short, and nothing is refunded for the unused part.

You do not need to write to anyone to leave. If the portal will not open for
you, write to the address above and it is ended by hand.

Ending the membership is not deleting your backup, and deleting your backup is
not ending the membership. They are separate on purpose and the app says so
where both are offered. If you want both, do both.

## what happens when it lapses

There are two ways in, and only one of them waits for the date.

The ordinary way is the date. For three days after a paid-until date passes,
nothing changes: a renewal that is slow, or a card that is retried, does not
cost you your backup.

The other way does not wait. If Stripe stops trying to collect, because the
retries are exhausted or the subscription is paused, the membership stops
accepting new backups from that moment even if the year you paid for still has
weeks left in it. Those weeks are not owed back and are not refunded. It is the
plainest case of the rule under **refunds**, and it is stated here rather than
left to be met.

After that the club stops accepting new backups, and nothing else. You can
still fetch what is stored, and you can still delete it, because it is yours
and not ours. That stays true once the membership has fully ended and not only
while it is late: reading and deleting are yours either way, and only writing a
new backup asks for good standing.

Paying what is outstanding on the same subscription puts you back in good
standing, with the same key, over the same backup.

**Starting a fresh membership after an old one has ended is not the same
thing.** Your key is derived from the subscription behind it, so a new
subscription is a new key, and a new key is a new and empty backup. The old one
is still there and still yours, and it is reachable only with the old key. If
you think you may come back, keep the old key alongside the phrase, or fetch
what is stored before you go. If you kept neither, write to the address above:
the key is derived rather than stored, so we can work it out again from the
payment it belonged to.

## refunds

The membership is not refundable, including the unused part of a paid year.

The reason is specific rather than commercial. Your membership key is derived
at the moment you pay, is handed to your device, and cannot be un-issued: from
then on you can seal, store and fetch, and there is no version of this where
the key is taken back. There is no metered part of the service to prorate.

Two things stand outside that.

If the law of your own country gives you a right to withdraw from a contract
made at a distance, and that right cannot be signed away, then it is not
signed away here. This club is sold to anyone, anywhere, with no country gate,
so it is sold to people who have that right. Write to the address above and it
will be honoured without argument.

And if we took your money and gave you nothing, that is not a refund question
but a mistake, and it is answered below.

## the phrase, and what losing it costs

Your envelopes are sealed under a phrase that is typed on your device and
never sent. We do not have it, cannot derive it, and cannot reset it.

**If you lose the phrase, the backup is lost.** Not withheld, not recoverable
by support, not recoverable by us under any process at all. The bytes remain
and no one can turn them back into an atlas. This is the same property that
makes the backup worth having, and it does not have a softer form.

Keep the phrase somewhere that survives the device it was typed on.

## how long your backups are kept

Until you delete them, or until the club closes.

Nothing on our side deletes an envelope on a timer. A membership that lapses
keeps its two envelopes and you keep the right to fetch and delete them. If
that ever changes, it changes with notice, in the same way a price change
does, and not quietly.

The bookkeeping behind the membership outlives the membership too, and for the
same reason: it is what tells your key from a stranger's, so it has to still be
there for you to fetch and delete after you have left. Ending the membership
does not remove it and neither does deleting your backups. Ask, and it is
deleted by hand. [The privacy notice](PRIVACY.md) lists exactly what it
holds.

## if you paid and did not get a key

This is recoverable, and it is recoverable a long time after the fact.

Your device makes a secret before it asks for anything and keeps it. Your
membership key is derived from the subscription behind your payment, so the
same key can be handed to the same device as often as it asks. A flat battery,
a closed tab, a browser that lost the return page: none of these costs you the
membership.

If you land back in the app with nothing, the club room accepts the checkout
session id, which begins `cs_`. **Keep that id if you see it.** Paste it there
and the door opens.

That route has a limit worth knowing. It works from the same browser that
started the payment, because the secret your device made is what proves the
session was yours, and that secret is discarded after thirty days. Past thirty
days, or from a different device, the id alone will not open the door and is
not meant to: anyone else holding it would open your membership if it did.

If that fails, or if you are past that, write to resonateselect@proton.me from
the address you paid with, and say what happened and roughly when. We can find
the subscription behind a payment and work out the key it belongs to, because
the key is derived rather than stored. Expect an answer within five working
days.

## if you lost the key and want the backup deleted

Every call to the vault is authenticated with the membership key and there is
no account to fall back on, so a member without the key cannot delete their
own backup from inside the app. That is the honest cost of having no accounts.

It can still be done, by hand, by us. The club operates the Stripe account,
Stripe maps a payment to a subscription, and our own storage maps that
subscription to a key and the key to a vault. Write from the address you paid
with and ask for the backup to be deleted, and it is deleted.

What that does not do is open anything. Nobody on our side can read an
envelope or reset a phrase, before or after such a request.

## if the club closes

The data half of this answer is
[question seventeen of the threat model](THREATS.md), and it has been
published since before anything was for sale. The commercial half is
here.

If we decide to close the club, then: you are told at the address you paid
with, and on the site, at least sixty days before anything stops; no further
renewal is taken from that announcement onward; the unexpired part of any year
already paid is refunded in full, which is the one case where the section
above does not apply; the vault stays readable and deletable for those sixty
days at minimum, so that every member can fetch what is theirs; and at the end
the envelopes are deleted rather than transferred, sold, or left running under
someone else.

If the club stops for a reason that is not a decision, an account lost or a
provider gone, then the notice period is whatever the failure allows, and the
refund position above still stands.

## what we do not promise

No uptime figure, because there is no operations team behind one and quoting a
number nobody is rostered to defend would be worse than saying this.

No independent audit. Nobody outside this project has reviewed the code for
security. The tests, the published specification and the fact that the page is
hand-readable are not a substitute, and none of them has found what an auditor
is paid to look for.

No warranty beyond what the law requires. The service is provided as it is.

The free atlas carries no promises at all: it runs in your browser, it is
yours, and it is not what is being sold here.

## liability

Where liability can lawfully be limited, it is limited to the fees you paid in
the twelve months before the event, and there is no liability for indirect
loss, for lost profit, or for the loss of data you also held elsewhere.

Where it cannot lawfully be limited, it is not limited. Nothing here excludes
liability for death or personal injury, for unlawful intent or gross
negligence, or anything else the applicable law refuses to let a seller
exclude in advance.

Read the phrase section above alongside this one. The single most likely way
for a member to lose an atlas is to lose the phrase, and that is not a failure
we can be liable for because it is not a failure we can reach.

## changing these terms

A change that affects what you have bought reaches you at the address you paid
with, before it applies to you, and never earlier than your next renewal. If
you do not want it, end the membership and the old terms run to the end of the
year you paid for.

Corrections that do not change what you bought, a clearer sentence, a fixed
address, a document renamed, are made when they are noticed, and the history
is public in the repository this site is built from.

## law and forum

Swiss law governs this agreement, and the courts at the seller's seat have
jurisdiction.

That clause does not, and is not meant to, take away the protections that the
law of the country you live in gives you and does not let you sign away. If
you buy as a consumer, those protections apply whatever this section says, and
we will not argue otherwise.
