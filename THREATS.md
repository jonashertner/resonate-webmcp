# The threat model

Twenty questions a skeptical reader should ask about the travellers club, and
about the device it backs up, each answered against the code as it stands. The
wire format is in club/SPEC.md; the reporting channel is in SECURITY.md and
/.well-known/security.txt. Where a defence has a limit, the limit is stated
rather than rounded up.

## 1. What does the club's server see?

Per member: the membership key, the Stripe subscription id, the Stripe billing
account id it belongs to, a paid-until date, the standing, a
notice-of-cancellation flag, the moment of the newest billing event applied,
the sealed envelope and the one before it, each envelope's byte size, and the
time of the last seal. One SQLite-backed Durable Object per Stripe subscription
is authoritative for the membership key and fields, event-order cursor and
revision. It also holds Stripe event ids and receipt times for thirty-day
deduplication; expired rows are removed on the next transition and can remain
stored longer when no transition follows. KV mirrors the membership and
subscription-to-key reverse pointer for compatibility and lookup, mirrors event
ids with a thirty-day expiry, and holds the untimed mint-secret fingerprint.
The vault Durable Object holds the current revision and two random object names;
R2 holds the ciphertext under those names.

If letters are used, a box at the membership's derived route holds its
paid-until copy and counts, and for each letter the message id, ciphertext, byte
length and arrival time. For each posting capability it holds the secret's
SHA-256, an eight-character revocation id and its mint time, never the secret.
There is no stored route-to-member map. The caps are 128 to 262144 bytes per
letter, 50 letters, 4194304 bytes total and 100 capabilities. Letters remain
until individually deleted or the box is burned; capabilities remain until
revoked or burned. Neither has a timer.

Per request: the worker sees whatever the request carries. A delivery therefore
puts the authenticated sender, destination route, capability secret, message id
and ciphertext together in memory. It stores the box record but no
sender-to-box history. Checkout, door, unknown-key and post requests are metered
at 8, 30, 30 and 120 per hour respectively under separate hashes of the caller's
IP. Each meter holds tokens left and a timestamp and deletes itself two hours
after last use. Raw invocation logs are off; deliberate identifier-free outcome
events are on, and Cloudflare controls their retention because the repository
sets none. It never sees a place, a note, a phrase, or a name. PRIVACY.md gives
the same inventory in data-rights terms.

## 2. What does the hosting provider see?

Two providers. GitHub Pages serves the static app: it sees the IP, user agent,
and which files it hands over, as any host does; the atlas never reaches it.
Cloudflare runs the club worker: its edge sees each request's metadata and
could log it under Cloudflare's own policies, outside our control. The
envelope passing through is ciphertext either way.

Attaching the club to `club.resonate.select` requires an active Cloudflare zone,
and Cloudflare delegates a single subdomain only at its enterprise tier, so the
club cannot answer at that hostname unless the whole zone moves to their
nameservers rather than the club's hostname alone. That makes Cloudflare
authoritative for `resonate.select` and gives it resolver traffic for the site
as well as for the club. It is a swap of one DNS operator for another rather
than a new observer, and the club already stands behind Cloudflare, but reading
the site becomes visible to the company that runs the club, and that is worth
knowing rather than discovering.

## 3. What does the payment processor see?

Stripe holds the member's name, card and email; that is Stripe's business. The
club holds only the subscription id. The linkage is real: if Stripe were made
to answer for a subscription id, the id in the club's records could connect a
vault to a person. Stated on the how page in the same words.

## 4. What if the club's database is stolen?

The thief holds ciphertext and the metadata of question 1. Opening an envelope
means guessing its phrase offline against Argon2id at 64 MiB and three passes,
or against PBKDF2 at 600000 iterations where a device could not run Argon2id
and at 310000 for envelopes sealed before this format. The club room names
which dialect sealed the envelope it holds. A strong phrase makes
this impractical; a weak one does not, and no server-side control can help,
because the server never sees the phrase. The floor is eight characters; the
guidance says longer, in words.

## 5. What if the application's JavaScript is compromised?

This is the trust root, and no cryptography beneath it survives it. A hostile
deploy could read the atlas and the phrase as it is typed. The mitigations
that exist: no third-party script and no analytics; every dependency vendored
into the repository and served from the site's own origin, the Argon2id
library additionally pinned by committed digest, re-checked in CI, and loaded
under a subresource integrity hash; a strict content security policy; tests
and a parse gate in CI before any deploy; a no-build codebase a reader can
inspect as served. One deliberate widening: the policy permits WebAssembly
compilation, which Argon2id needs. It permits no external script, so only
code already served from this origin can use it. The residual risk is the operator's
deploy pipeline, and honesty requires saying that plainly.

## 6. What about a weak recovery phrase?

The envelope is only as strong as its phrase (question 4). The club cannot
check phrase strength because it never sees the phrase. The client enforces
only a floor and asks for words rather than characters.

## 7. Can the club roll a member back to an older envelope?

Not silently, for a device that has sealed before: the count inside the sealed
wrapper is monotonic, and the client refuses an envelope older than it has
seen, refuses an empty vault over a history of sealing, and refuses to seal
over anything it could not merge. The stated limit: a brand-new device has no
history and would accept whatever the vault serves. The member-initiated form
of rollback exists on purpose: the envelope before, in the club room.

## 8. Can one device corrupt another's atlas?

The merge is additive by identifier and rolls back whole when the device
refuses a write, so a sync cannot delete places and a failed sync cannot leave
a half-written atlas. A hostile envelope body passes the same schema gate as
any share link.

## 9. How do deletions synchronise?

They do not, and this is stated in the app rather than hidden: the envelope is
a backup, not a ledger. A place removed on one device returns from an envelope
sealed on another; erase-then-sync restores the atlas, which is the backup
working as promised. The only true deletions are burning the envelopes and
erasing each device.

## 10. What remains after a subscription lapses?

Sealing stops after the paid-until date plus three days of grace. Reading and
deleting continue: the envelope stays the member's whatever the standing. The
envelopes persist until the member burns them.

## 11. What about the server's own backups?

Deletion removes the readable vault head first and atomically moves both R2
object names into a durable tombstone. From then on the API cannot fetch either
envelope. It asks R2 to delete them; if R2 does not confirm, the request returns
202 and the tombstone keeps the names and attempt count while an alarm retries,
with delays capped at one day and no maximum attempt count. Only confirmation
removes the tombstone. Cloudflare's infrastructure may retain replicas beyond
that under its own policies. All of those bytes are ciphertext, and question 4
applies to them.

## 12. Can support identify a member?

There are no accounts and no names on our side, but the chain exists and
honesty requires naming it: the club operates the Stripe account, Stripe's
dashboard maps a name or email to a subscription id, and the club's own
storage maps that subscription id to a key, and the key to a vault. Support
can therefore find which vault belongs to a paying person, using its own
credentials, without compulsion. What support can never do is open an
envelope or reset a phrase; those keys exist only on members' devices.

## 13. Can two devices sealing at once erase one another?

A seal used to overwrite whatever was there, so two devices could read the
same envelope, merge it into their own atlas, and seal in turn: the second
erased the first, and the loser's records left no trace anywhere. The vault
now answers compare-and-swap. Every seal mints a revision of sixteen random
bytes, served as a strong ETag, and a PUT must say which envelope it believes
it is replacing: `If-Match: "<rev>"`, or `If-None-Match: *` for the first seal
into an empty vault. Sending neither header is 428, so a seal that says
nothing about what it replaces is refused rather than obeyed. A revision that
is no longer current is 412, carrying the current ETag; the client reads again, merges,
and seals over what the vault now holds. `If-Match: *` matches nothing on
purpose, because a star means "whatever is there", which is the licence the
guard exists to refuse. The revision is minted rather than derived from the
envelope, so the ETag answers nothing about the ciphertext to anyone who asks.

That guard used to sit on eventually consistent storage, and this answer used
to concede the rest: two devices sealing in the same instant could both read
the same revision, both pass the check, and both write, and the later write
stood. What closed was the minutes-and-hours window, which is the one that
happens. The instant was left open, and a conceded race is not a defence once
somebody has paid for the thing being raced for.

It is closed now. The revision and the two object names live in a Durable
Object, one per membership, where the comparison and the rotation happen
inside a single blocked section: one seal enters at a time, and the second
reads the revision the first committed and is refused. The ciphertext lives in
R2 under a name of twenty-four random bytes that is never reused, so the two
operations are an upload and a rotation, in that order, and every way of dying
between them is harmless in the same direction. A death before the rotation
leaves an object nobody points at. A death during it leaves the pointers
exactly as they were, because the rotation is one write of one value. A death
after it leaves a whole state whose answer was merely lost, and the device
that asks again is told the revision has moved.

The residue that remains, stated: an upload that is never committed is litter
in the bucket, and litter costs money rather than truth. Routine rotation
collects only the object it just evicted. A burn removes the readable pointers
first and copies exactly the current and previous ids into the retry tombstone,
so neither collection path can reach an object a readable vault still names.

## 14. What can a stranger holding a checkout session id do?

Nothing, now. It used to be a window, and the window is closed.

The old shape bound the device to the payment *after* the payment: the device
minted a secret, hashed it together with the session id, and presented that at
the door. It covered the answer that got lost, which was the failure it was
built for, but it left a real gap. Before the paying device knocked, the session
id alone was the credential, and whoever presented it first with any well formed
claim minted the key. The id lives in the return address the paying browser is
sent to, so the window was a race against the payer's own browser on their own
return, but it was a window.

The binding is now made before the payment. The device mints a secret of sixteen
random bytes, keeps it, and sends only `SHA-256("tc-join:" + secret)`. The club
creates the checkout session itself and writes that commitment into the
session's metadata, and into the subscription's, where Stripe holds it. Coming
back, the device presents the secret; the club hashes it under the same label
and compares. A stranger holding the session id holds a number that opens
nothing, and there is no order of events in which presenting it first helps: a
session with somebody else's commitment on it is refused whoever knocks.

There is no claim record and no window. The binding lives in Stripe's metadata,
so a device that kept its secret can be handed its key a week or a year later,
and the failure the old window existed to cover is covered better: the answer
that got lost can be asked for again for as long as the secret survives.

What is left is the device itself. A device that loses its secret before it
comes back has paid and cannot open the door, and no amount of protocol fixes
that from the outside. The membership exists, the payment is real, and the key
is recomputable from the subscription id under the mint secret; so the recovery
is a deliberate operation by us, on a subscription we can see at Stripe, and not
a second credential left lying about for convenience.

## 15. What can another app push into this one?

A place shared into the app from a phone's share sheet is the one thing that
must not go on the wire, so the POST share target is answered by the service
worker on the device. The title, the text and the address never leave, not
even as a request the host could log.

The worker bounds what it accepts. A body declaring more than 1 MB is refused
before it is parsed at all. Each field has its own ceiling, 2048 for the
address, 300 for the title, 2000 for the text, and the sum is bounded at 4096
as well, because the sum is what lands in the store. Fields are cut to their
own ceiling and then to whatever is left of the total, with the address served
first, since that is where the coordinates live. A record that had to be cut
carries a flag saying so, and the app says a share arrived in part rather than
pretending it arrived whole. Three blank fields are not a share and nothing is
written. A body that will not parse as a form writes nothing either.

The redirect honours what actually happened: `?shared=1` only when the write
succeeded and something is waiting, `?shared=0` when the worker kept nothing,
whether the body was oversize, unreadable, blank, or the store refused it. One
digit, and not a word of the place, in the address. The stated limit: the
megabyte ceiling is read off the declared content length, so a body that
arrives without one is parsed, and the field ceilings are what hold then.

## 16. What if this device's own store will not read?

A key whose JSON will not parse used to be caught and handed back as an empty
list. The app drew an empty atlas, and the very next edit wrote that emptiness
over the damaged bytes. One corrupt byte became a blank life, permanently, on
the next keystroke, and nobody was told.

Such a key is now quarantined. The damaged bytes are left exactly where they
are, a copy is set aside under a name that says what it is, and never over a
copy an earlier load already set aside; every write to that key is then
refused, through the same channel that reports a failed write, so the app
already knows how to say it out loud. It says it at first paint, before
anything else happens, and offers to export everything that still reads.

The consequence is deliberate and worth naming: a sealed key makes that part
of the app read-only until a person chooses. The rest of the atlas works. The
person can leave it, take the rescue export, or start that part fresh, and
starting fresh releases the seal without touching the copy set aside, because
moving on is not the same decision as destroying. The limits: the seal is held
for the session, so a reload reads the same damaged bytes and seals again,
which is the intent; setting the copy aside needs room, and a device with none
still leaves the original untouched; and a key that parses but holds wrong
values is not this case at all, which is the schema gate's work, not this one.

## 17. What if the club itself goes away?

The envelopes go with it, and this is the deliberate limit of what is being
sold. A member's current envelope and the one before it live in a single
Cloudflare account, and they are not copied anywhere else. What
the club protects against is losing your device: a phone in a river, a browser
cleared, a laptop stolen, the store on this machine refusing to read. What it
does not protect against is losing our account, whether to a mistake of ours, a
suspension, a bill unpaid, or an outage that does not end.

That is a choice rather than an oversight. Copying the envelopes to a second
company would double what is held about a member and double the reach of a
subpoena or a breach, for a failure that a member can already answer better than
we can: the exports under **your data** are the copy nobody can take away. A file
you keep is the only copy whose survival does not depend on us, and the app
offers it in seven forms without asking for anything.

So the club is a backup of your device, not an archive of record. If the worker
disappears tomorrow, every atlas keeps living in the browser that holds it and
only the backup goes quiet. If a device and the club were lost in the same week,
what survives is what was exported. The app says so where the backup is offered
rather than only here.

## 18. Who can read a letter one member sends another?

The recipient, and after that whoever holds the recipient's device.

A letter is sealed with RFC 9180 HPKE in mode `auth`: DHKEM(P-256,
HKDF-SHA256), HKDF-SHA256, AES-256-GCM, nonces derived from the key schedule
rather than sent on the wire. Mode `auth` mixes the sender's own private key
into the derivation, so opening a letter proves who wrote it as well as that it
is unchanged. The club holds the ciphertext, its length, and the moment it
arrived; both public keys travelled in the introduction and the return, and
neither has ever been at the club. The wire format and every refusal are in
club/SPEC.md, and the implementation is checked against the RFC's own published
test vectors at every intermediate value, not only at the final ciphertext.

Six limits, each real:

**No independent cryptographic review has been published.** The construction is
checked against RFC 9180's own published test vectors at every intermediate
value, which proves it matches the specification. It does not prove that the
code around the construction uses it correctly. That is the difference between a
verified construction and a reviewed implementation, and only the first of the
two is claimed here.

**A correspondent's device opens everything you ever sent them.** That is what a
letter is. There is no expiry that can be enforced on somebody else's copy, and
this model does not pretend otherwise.

**Mode `auth` is open to key-compromise impersonation.** RFC 9180 section 9.1
states it: somebody who holds a recipient's private key can forge letters that
appear to come from anyone to that recipient. They already read everything
addressed there, so this widens a compromise rather than starting one, and it is
the reason a lost key means re-pairing out loud rather than quietly.

**The club sees the shape of the traffic, live.** Posting authenticates the
sender, so in the instant of delivery the club knows that this member wrote to
that box. It stores none of it: the box address is derived from a membership key
under a one-way function and nothing in the club maps it back, and the stored
bytes name nobody. Raw invocation logs are disabled, but the worker emits a
`letters.posted` event or a refusal reason, without sender, route, capability or
message id. The knowledge still exists for the length of a request, and an
operator who changed the code could record it. That is a policy and a design,
not an impossibility, and it must never be sold as one.

**An introduction is reusable and is not a name.** Anyone who obtains the link
can post to that box until it is withdrawn. A matching name authorises nothing;
what binds a correspondent is the mark, which covers both public keys and both
letterbox routes. Posting secrets are deliberately excluded, so replacing a
capability does not make two people repeat the identity check. The mark has to
be confirmed before an exchange is trusted.

**Sizes and timings travel.** Nothing here pads a letter or delays it.

## 19. If a recovery phrase is weak, what does a club breach cost?

More than it used to, and this is a decision taken on 16 August 2026 with the
cost accepted rather than a defect found afterwards.

A member's cryptographic identity is their membership rather than a particular
device, so the private key travels inside the portable archive, sealed under the
recovery phrase with Argon2id. That is what makes a second device, a replaced
phone and a restore possible at all, and what stops a lost handset from leaving
correspondents writing to a key nobody holds.

The price is that the key can leave the device. Before this, an envelope taken
from the club and opened by guessing a weak phrase disclosed what was in it.
Now, the same guess also yields the private key, and whoever holds it can write
letters that are genuinely from that member until the pairing is withdrawn. A
weak phrase plus a breach of the club is impersonation, not merely disclosure.

The defences are the ordinary ones and they are stated plainly rather than
leaned on: the phrase is generated by the app rather than chosen, Argon2id makes
each guess expensive, the archive is never sent anywhere without being sealed
first, and a member who suspects their phrase can revoke every posting
capability and re-pair. A phrase a member has replaced with something memorable
is the case this cannot help with, and the app says so where the phrase is shown.

## 20. What may a browser assistant read or change?

Before consent, a browser with WebMCP may call one same-origin, zero-data tool.
It accepts no arguments, returns no atlas data, cannot grant access, and only
opens a dedicated in-app review with no name, counts, or records in it. A browser
without WebMCP has no tool path at all. When the person presses **Allow access**,
the review tool is replaced by five same-origin tools for the lifetime of the page. Two read:
an overview and a search. Both are built from the same outward disclosure a
friend receives, so a record marked never to leave, contacts, lists, settings,
snapshots, dates and the club key cannot reach them. Every result is bounded
and returned as a versioned structured object. Search pagination is bound to
both the exact filters and the disclosed result set, so a changed atlas makes
an old cursor fail closed. The app validates every argument itself rather than
assuming an experimental browser enforced the advertised schema. Results that
carry record text are annotated as untrusted user content.

Three tools act only on the visible interface: show an existing item, prepare
a place, and prepare a list. Showing edits nothing. A place proposal has no
input for visited, rating, privacy, provenance, creation time or a recorded
path, and becomes a record only when a person presses the keep button; it then
begins as want to go. A list proposal opens the ordinary composer and saves
nothing when closed untouched. No tool deletes, publishes, downloads, sends,
shares, opens a cross-origin capability, or calls a Resonate server. Turning
the setting off aborts the five data registrations and restores only the
zero-data review tool. Each invocation also carries its own
cancellation signal, and the consent session is checked before and after the
tool runs. Pagehide ends the session; a page restored from the back-forward
cache rereads durable consent before registering anything again, so a queued
call cannot outrun a revocation made while the page slept. Expected input,
cursor and review-state refusals are structured results; cancellation and
unexpected faults remain failures.

The residual risk is the assistant itself. Prompt injection cannot be made
impossible: notes, names, links and tags may contain hostile instructions, and
the untrusted-content annotation is a warning rather than a sandbox. A browser
extension with permission to read this site may already be able to manipulate
the page without WebMCP. The five data tools reduce ambiguity and authority; they do
not control what an assistant provider retains after reading a result. The
permission sentence in Settings and the assistant contract state that cost at
the point of choice.
