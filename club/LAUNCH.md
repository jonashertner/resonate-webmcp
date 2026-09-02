# Opening the club

The order below is not the obvious one, and the reason is that three things each
need something another one mints: the webhook needs a URL that does not exist
until Cloudflare is done, the worker needs a Price id that does not exist until
Stripe is done, and the app must not be able to sell anything until both work.

Everything in the app is already written and tested. Nothing here is code.

Read this whole file once before starting. **Four steps have no rollback and all
four are marked**: the sandbox Price, the R2 bucket's location, the mint secret,
and the live Price.

---

## What is settled, and what is not

**The membership is CHF 48 a year, in Swiss francs only, tax-inclusive.**

One currency at launch is deliberate. Offering euros and dollars is not a
setting, it is a release: `TERMS.currency` becomes a set, `admits()` changes, the
checkout and door tests change, and three amounts become immutable at once,
priced off an exchange rate that will have moved by the time anyone abroad
actually joins. A German or American buyer can pay CHF 48 today and their card
issuer converts. `STRIPE_PRICE_ALSO` exists so that a second Price carrying more
currencies can be added later without stranding anyone who paid at the first.

**The service is standard-rate, and the price is tax-inclusive.** Inclusive is
the right call precisely because the seller is not yet registered: when
registration eventually comes, an inclusive price means the sticker does not
move. CHF 48 stays CHF 48 and the tax comes out of it. With `exclusive`,
registration day turns CHF 48 into CHF 51.89 on the page, a price rise for every
existing member arriving for a reason none of them caused.

**The club sells to Swiss customers.** Decided 2026-08-14. Below the CHF 100,000
threshold there is no Swiss registration and no Swiss VAT, so CHF 48 is CHF 48.
The threshold counts *worldwide* turnover, which at this price is about 2,080
members, and that is the horizon at which this paragraph has to be rewritten.

**That decision is an assumption, not a mechanism, and the difference is where
the money is.** There is no country gate anywhere in this club: Checkout takes a
German, British or Norwegian card the moment the door opens, and liability
attaches to the sale rather than to the intention behind it. For B2C
electronically supplied services the place of supply is the customer's country,
and these apply **no threshold at all** to a seller established outside them:

| | rate | threshold for a non-established seller |
| --- | --- | --- |
| EU (non-Union OSS) | 17% to 27%, by member state | none. The EUR 10,000 micro-threshold requires establishment in a member state |
| United Kingdom | 20% | none |
| Norway (VOEC) | 25% | none |
| Iceland (VOES) | 24% | none |
| Turkey | 20% | none |
| United States | state sales tax | roughly USD 100,000 per state, so not yet |

No gate is being built, deliberately. At beta-cohort scale the exposure is
nothing, `request.cf.country` would be a privacy behaviour change in an app that
collects nothing else, and a wrong block turns away a Swiss member on a VPN.

**The trigger for revisiting it: the first member who is not in Switzerland.**
Stripe's Dashboard shows the card's country on every payment, so this is
visible without collecting anything. On that day the choice is to register where
they are, refund and refuse, or gate `/checkout` on country. Decide it then,
with an adviser, and not by letting it accumulate.

**This is not tax advice and I am not qualified to give it.** It is a record of
what was decided and of what the decision does not cover.

---

## Already done

**`main` is protected.** Set 2026-08-14 via the API, because the Dashboard path
has two traps in it. Current state:

```
required checks   test, browser     (job names, and the only two with a pull_request trigger)
strict            true
approvals         0
enforce_admins    true
force pushes      blocked
deletions         blocked
```

Three things about that, because each one is a way the same five minutes goes
wrong:

- **`enforce_admins` is what makes it real.** GitHub's own wording: *branch
  protection restrictions do not apply to people with admin permissions*. Off, as
  it is by default, you can still push straight to `main` and the rule buys
  nothing.
- **Approvals must be 0.** GitHub does not let a pull request's author approve
  it, so on a one-account repository any non-zero count is unsatisfiable, and
  with bypass closed you could never merge your own launch commit. Zero still
  forces PR-only merging.
- **`test` and `browser` are the right contexts, and `deploy` and `smoke` are
  not.** The latter two have no `pull_request:` trigger, so requiring them leaves
  every pull request Pending forever.

A red build already could not deploy: `deploy` in `.github/workflows/pages.yml`
declares `needs: [test, browser]`. What was missing was any requirement that a
change be proposed at all before it went out. **Every step below that says
"push" now means: branch, pull request, wait for green, merge.**

To reopen the branch in an emergency:

```bash
gh api -X DELETE repos/jonashertner/resonate-webmcp/branches/main/protection/enforce_admins
```

---

## 1. Stripe, in a sandbox: the product

Create the product **travellers club** with exactly one recurring price: **CHF
48, yearly, tax behaviour `inclusive`**. One price on it, in one currency, now
and always. Keep the Price id.

> **No rollback.** A Price's amount, currency, interval and (once set) tax
> behaviour can never be edited. Getting it wrong here is cheap: create
> another, retype one line of `wrangler.toml`, and step 5b clears the sandbox
> rows anyway. Getting it wrong in **step 6** is not, which is why that step
> carries the same mark.
>
> **Two of those words are doing more work than they look like.** *Once set*
> is the exception the API documents: `tax_behavior` may move exactly once,
> out of `unspecified` and never again, so a Price left unspecified is
> repairable with a single `POST /v1/prices/:id` and one left `exclusive` is
> not. And the wrong Price does not have to be archived: the Dashboard will
> **delete** a Price that has never been used, which is the ordinary case for
> one made a minute ago. There is no delete in the API at all, so archiving is
> the only remedy that can be scripted, which is why every other page says
> archive.

**Set the billing period deliberately.** In the Dashboard the path is Product
catalog, add a product, pricing model **Flat rate**, then **Recurring**, and
only then does the **Billing period** field appear. Yearly is a choice made in
that field and not a consequence of anything else on the form, so read it back
before saving. A Price that says `month` is a Price to be deleted, and that is
cheaper than it sounds only while nobody has bought it.

**A note on where you are.** Stripe sandboxes are not legacy test mode. They
are separate copies of the account with their own products, keys, webhooks and
portal configuration, and the **environment switcher** is the only route into
one that Stripe documents: every instruction on its sandbox pages begins at the
account selector. Test mode still exists beside them, and Stripe's own sandbox
documentation says so in the course of saying something else, that sandbox
roles "do not change your access to test mode". Navigating there by typing a
`/test/...` path is undocumented either way, which is the reason not to: a
product, a portal setting or a webhook saved in the wrong store configures
nothing for the key this worker will hold, and nothing announces it.

**And the key cannot tell you which store you were in.** A sandbox issues
`pk_test_`, `rk_test_` and `sk_test_`, the same three prefixes test mode uses;
there is no `rk_sandbox_`. So the prefix answers exactly one question, live or
not, and answers it definitively: `rk_live_` and `sk_live_` are live-mode keys
and are never a sandbox. Which non-live store a `_test_` key came from is
answered only by how you navigated to make it. Navigate from inside the sandbox
for everything in this section, and if you are unsure afterwards, make it again
rather than reasoning about it.

**Configure the customer portal.** With the sandbox selected, Settings → Billing
→ Customer portal. Click **Activate** if it has never been touched, and enable
**Cancel subscription** under Cancellation management. In that same section,
confirm that cancellation takes effect **at the end of the billing period** and
not immediately: the club room's *leaving* state is Stripe's
`cancel_at_period_end`, and an immediate cancellation both skips that state and
takes back a year already paid for. Save.

**Turn Adaptive Pricing off** at Settings → Payments → Adaptive Pricing, again
from inside the sandbox. The worker also refuses it per session, which is the
belt; this is the braces, and it is set separately in each sandbox and in live.

**Create a restricted API key** with exactly three resources:

| Resource | Level | Where it is in the list |
| --- | --- | --- |
| Checkout Sessions | Write | its own group, not under Payments or Billing |
| Subscriptions | Read | under Billing |
| Customer portal | Write | under Billing |

There is no resource called "Billing Portal Sessions"; looking for that name
will not find it. Stripe's own naming is inconsistent here (the API reference
says *Customer Portal Sessions*, the endpoint is `/v1/billing_portal/sessions`,
the webhook event is `billing_portal.session.created`), so search for **Customer
portal** and, failing that, look under the **Billing** heading.

Write implies read, which Stripe states directly, so Checkout Sessions Write
covers retrieval too. Subscriptions Read is separate and load-bearing: the club
fetches the session with `?expand[]=subscription` because the price, the
currency and the interval exist only in that expansion, and expanding an object
requires permission on that object. Stripe does document that much, though not
where anyone building this would look: it is on the **Stripe Apps** permissions
reference, which happens to use the same permission names restricted keys do,
and it says that expanding an object in a response means asking for a
permission on each expanded object too. Neither the restricted-keys page nor
the expanding-responses page repeats it.

What is documented nowhere is what a key *without* that permission gets back,
and the answer is the dangerous one: not an error, but the object quietly
replaced by its bare id. A permission failure that fails open on a sub-field is
exactly the kind a happy path never notices, which is why 1b reads that field
and says so out loud.

**Where the key goes, and the one place it must never go.** It has exactly two
destinations, and the same pair of hands types both: `npx wrangler secret put
STRIPE_SECRET` in step 3, and a shell variable for the proofs below. Read it in
rather than typing it, so it does not land in the history either:

```bash
read -rs SK && export SK
```

It does not go into a file in this repository, a commit message, an issue, a
screenshot, or the transcript of a session with an assistant. That last one is
the easy one to do by accident and the hard one to undo, because a transcript
is written to disk and stays there. **Roll first and work out the exposure
afterwards.** A rolled key costs one minute and a new secret; a leaked one
costs whatever its scope allows, and scope is not the prefix: a restricted key
carrying Checkout Sessions write and Customer portal write can open live
sessions against this account, and a test key can rewrite the very products
and Price ids the rest of this file depends on.

**Rolling is not immediate unless you say so**, and this is the detail that
turns a roll into a week of continued exposure. The API keys tab, overflow menu
(⋯) beside the key, **Roll key**, and then Stripe asks how long the *old* key
stays valid. It offers up to seven days, which exists so that a deployment can
be rotated without downtime, and it is the wrong answer for a key that has
leaked. Choose **Now**. The old key is deleted, whatever is still holding it
starts failing, and that is the point: a key you are rolling because it got out
should stop working before you have finished working out where it went.

### 1b. Prove the key before anything is built on it

**`club/proof.sh` runs everything in this section**, and it is the same
requests: same endpoints, same parameters, same pinned version. What it removes
is the retyping, because a proof retyped at the end of a long afternoon is a
proof that passes with a flag missing, and the flags are the whole point. It
also refuses to start against a live key or a full-access one, which are the
two keys most likely to be in the shell when somebody reaches for this.

```bash
./club/proof.sh walk            # asks for the key and the Price id, then
                                # checks the Price, opens a session, waits
                                # while you pay, and reads it back
./club/proof.sh taxfix          # the one repair: tax_behavior, once
./club/proof.sh portal cus_...  # the permission that lets a member leave
```

**`taxfix` is the only command here that writes**, and it is in a reading
script for one reason: the alternative is a hand-typed `curl` carrying
`-u "$SK:"`, which puts the key back on a command line and back in the
history. So the write is here to keep the key out of the history, not to save
anybody typing, and it is built to be refused rather than to be convenient. It
reads the Price first and stops unless `tax_behavior` is exactly
`unspecified`; it prints the Price id, the change and the word *permanent*; it
asks for the word `inclusive` to be typed out rather than a key pressed; and
it reads the Price back afterwards instead of believing the response to its
own request. Everything else in the file only looks.

**It asks for the key rather than expecting it exported**, and that is a
correction rather than a convenience. The first version of this section said to
run `read -rs SK && export SK` first, which prints no prompt, so the terminal
looks hung; echoes nothing, so a paste looks like nothing; and names a variable
`SK`, which reads as a placeholder and gets replaced with the key, putting it
in the shell history. Three ways to fail, for a step whose only purpose was to
keep the key out of the history. A prompt has none of them.

The rest of this section is what it does and why, and stays here because a
script that is trusted without being read is not a proof of anything.

```bash
# Read these; the script is what to run. Typed by hand, the first line puts
# the key in your shell history, which is the one thing 1a asked you to
# avoid. If you do run them anyway, use the script's prompt for SK.
export SK=rk_test_...          # the restricted key
export PRICE=price_...         # the Price id

export CLAIM=$(openssl rand -hex 32)   # stands in for a device's commitment

curl -s https://api.stripe.com/v1/checkout/sessions -u "$SK:" \
  -H "Stripe-Version: 2025-03-31.basil" \
  -H "Idempotency-Key: launch-proof-$CLAIM" \
  -d mode=subscription -d "line_items[0][price]=$PRICE" \
  -d "line_items[0][quantity]=1" \
  -d "payment_method_types[0]=card" \
  -d "adaptive_pricing[enabled]=false" \
  -d allow_promotion_codes=false \
  -d billing_address_collection=auto \
  -d "metadata[claim]=$CLAIM" \
  -d "subscription_data[metadata][claim]=$CLAIM" \
  -d success_url=https://resonate.select/ -d cancel_url=https://resonate.select/ \
  | python3 -c "
import sys,json
s=json.load(sys.stdin)
ap=s.get('adaptive_pricing')
if (ap or {}).get('enabled'):
    raise SystemExit('ADAPTIVE PRICING IS ON for this session: %r' % (ap,))
print('adaptive_pricing:', ap, '(None means NOT PROVED, not off)')
print(s.get('id'))
print(s.get('url'))"
```

**That first check is not decoration, and it is here because the documentation
runs out.** Stripe documents `adaptive_pricing.enabled` as a parameter, and
documents what `true` does, and says the field otherwise defaults to the
Dashboard setting. It says nothing anywhere about what `false` does, and
nothing about whether a session-level `false` beats an account-level on. The
worker sends it as the belt to the Dashboard's braces, so the belt is a
behaviour nobody has written down, and the only honest way to hold a belt like
that is to pull on it. If this ever starts printing an enabled session, the
club's one-currency promise is the thing that broke, and it will have broken
silently: the page still says CHF 48 while the buyer is charged in their own
currency at Stripe's rate.

Every parameter above is one the worker sends, and that is the point of
sending them here: a shorter proof passes on account states under which the
club's own request would still be refused. `payment_method_types[0]=card`
narrows the session to one method and can collide with an account that has not
enabled cards. The commitment travels twice on purpose: `metadata[claim]` is
the one the door actually reads, and
`subscription_data[metadata][claim]` writes the same value onto the
subscription, where it outlives the session for a recovery done by hand a year
later and is read by no code. And the `Idempotency-Key` header is the one thing
here that behaves differently on a second attempt. If this call succeeds and
the worker's own later fails, the difference is not in the request.

**The version in that header is deliberately not the newest**, and it should
stay that way until someone reads a changelog rather than a version number.
`2025-03-31.basil` is what `club/src/stripe.js` pins, and the proof pins it too
so that the proof and the worker are asking the same Stripe. Checked
2026-08-14: the current version is `2026-07-29.dahlia`, two majors on, and
every parameter above still exists under it with no deprecation against any of
them. So this is a pin and not neglect. Moving it is a code change with its own
tests, not a header edit made here on the day of a launch.

Read the `url` out deliberately: Stripe returns `id` and `object` first and the
rest alphabetically, so `url` sits far down the body and `head -20` will not
show it.

Pay that url with test card `4242 4242 4242 4242`, then read the session back:

```bash
curl -s "https://api.stripe.com/v1/checkout/sessions/cs_test_...?expand[]=subscription" \
  -u "$SK:" -H "Stripe-Version: 2025-03-31.basil" \
  | python3 -c "
import sys,json
s=json.load(sys.stdin)
sub=s['subscription']
if isinstance(sub,str):
    raise SystemExit('SUBSCRIPTIONS READ IS MISSING: subscription came back as a bare id, not an object')
i=sub['items']['data'][0]
print(s['payment_status'], s['status'], s['livemode'], i['price']['id'],
      i['price']['currency'], i['price']['recurring'], i['quantity'])"
```

The explicit check matters: with a plain subscript, a bare-string subscription
raises a `TypeError` about string indices, which reads like a broken script
rather than the missing permission it actually is. If the line prints the price
id, `chf`, a yearly recurring and `1`, two of the three resources are proved.

**The third is not proved by the above, and it is the one that strands a member
who wants to leave.** Create a throwaway Customer in the sandbox Dashboard (the
restricted key cannot create one), then:

```bash
curl -s https://api.stripe.com/v1/billing_portal/sessions -u "$SK:" \
  -H "Stripe-Version: 2025-03-31.basil" \
  -d customer=cus_... -d return_url=https://resonate.select/ | python3 -m json.tool
```

A body containing a `url` is the pass. On failure read the error `message` as
well as the status, because the status alone splits the cases the wrong way: a
key without the permission is **403**, while an unconfigured portal and a
customer id that does not exist are both **400** and mean entirely different
things. Delete the throwaway customer afterwards.

This proof carries more weight than it looks like it should. Stripe's own
description of Customer Portal **Write** is that it "lets you create and update
portal settings", which is the *configuration* object and not a session. That
creating a session needs the same permission follows only from the general rule
that a POST maps to write on its resource, and a rule plus an inference is not
the same as a documented answer. Three lines of curl settle it, and the day it
is wrong is the day a member who wants to leave cannot.

---

## 2. Cloudflare DNS: move the zone

Only a full setup works. Cloudflare's subdomain delegation is Enterprise-only
and CNAME (partial) setup is Business or Enterprise, and a Workers custom domain
requires an active zone in your account. There is no arrangement where the zone
stays at GoDaddy. (Do not follow Cloudflare **Pages** instructions here: Pages
allows a plain CNAME for a subdomain, Workers does not.)

The zone is small, which is most of the risk gone. Inventoried 2026-08-13: four
apex `A` records for GitHub Pages, one `www` CNAME to `jonashertner.github.io`,
one `_dmarc` TXT. **No MX, no DNSSEC, no CAA, no AAAA**, so the two things that
usually make a zone move dangerous, mail and a signed delegation, do not apply.

Do it in this order. The nameserver change is last, not first.

1. **Record the zone as it stands**, so a rollback is a document and not a
   memory. **This is done**: the record is `club/ZONE.md`, written 2026-08-16
   from the commands below. Run them again on the day and compare, because
   what that file proves is what the zone was, not what it is.
   ```bash
   for t in NS SOA A AAAA MX TXT CAA DNSKEY; do echo "== $t"; dig +noall +answer $t resonate.select; done
   dig +noall +answer CNAME www.resonate.select
   dig +noall +answer TXT _dmarc.resonate.select
   ```
   `DNSKEY` is in that loop on purpose: step 6 asks you to confirm DNSSEC is off,
   and a query never made cannot fail. Note also that `dig` cannot enumerate a
   zone, only answer the questions asked, so **also export the zone file from
   GoDaddy**, at Domain Portfolio → `resonate.select` → DNS → Actions → Export
   Zone File. That export is not optional politeness. GoDaddy documents nothing
   about keeping your zone after you point the nameservers elsewhere, so the
   rollback below is only as real as the file you exported. The list above is
   what is known to exist, not proof that nothing else does.
2. **Confirm no domain forwarding**, at Domain Portfolio → `resonate.select` →
   DNS → Forwarding. It must be empty, and it must stay empty forever. This is
   the one GoDaddy feature that silently undoes the whole move: the help page
   says *we'll automatically update your domain to GoDaddy nameservers if they
   aren't with us*, and adding forwarding *will automatically update and lock
   your @ A record*. Turned on months from now, by you, looking for something
   else, it takes the delegation back off Cloudflare without asking.
3. **Add the zone at Cloudflare** and let the quick scan import it. The button
   is **Onboard a domain** under **Domains**; older guides say *Add a site* and
   the dashboard was redesigned between May and July 2026, so trust the screen
   over any screenshot. Enter the apex alone, never `www`. This changes nothing
   yet: GoDaddy is still answering.
4. **Reconcile by hand, in both directions.** Cloudflare says outright that the
   quick scan *is not guaranteed to find all existing DNS records*, so it is a
   draft and step 1 is the inventory. What that sentence does not say, and what
   happened here on 2026-08-16, is that the scan also **adds records that do
   not exist**. It imported a second `_dmarc` TXT reading `"v=DMARC1"` beside
   the real one. Two records at `_dmarc` is not a stricter policy, it is no
   policy at all: RFC 7489 says that if the set contains multiple records,
   *policy discovery terminates and DMARC processing is not applied to this
   message*. So a scan nobody read would have quietly turned `p=quarantine`
   into nothing, on a domain about to take payments, and no page anywhere would
   have said so. **Delete every row you cannot find in `ZONE.md`.**

   It cuts the other way too, and `ZONE.md` was the one that was wrong: the
   scan found `_domainconnect`, a CNAME to GoDaddy's own endpoint that `dig`
   never reported because nobody knew to ask for the name. That record is what
   lets a third party reconfigure the zone at GoDaddy, and it should not
   travel. Do not recreate it at Cloudflare.

   Compare line by line. The four Pages addresses are
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
   Nothing else may sit on the apex: GitHub documents extra records on `@` as a
   cause of certificate failure.
   *Optional, and a change rather than a move:* GitHub also serves IPv6 at
   `2606:50c0:8000::153`, `:8001::153`, `:8002::153` and `:8003::153`. All four
   or none, deliberately, and a partial set is a documented way to break the
   certificate.
5. **Set every web-facing record to DNS only** (grey cloud). Cloudflare's own
   words are *proxying is on by default when you onboard a domain via the
   dashboard*, and the zone-file import screen ships with **Proxy imported DNS
   records** already ticked, so doing nothing leaves four orange apex records
   and an orange `www`. Only A, AAAA and CNAME can be proxied at all, so the
   `_dmarc` TXT needs no thought and the five that do are the four A records
   and the `www` CNAME. **All four apex records or none**: Cloudflare treats
   every A record on a name as proxied if any one of them is.

   *Why, stated no more strongly than the sources allow.* Neither Cloudflare
   nor GitHub documents that proxying a GitHub Pages apex breaks certificate
   issuance or renewal, and an earlier draft of this line said they did.
   Cloudflare's guidance names Wix, Squarespace and Webflow, not GitHub; its
   redirect-loop page is about **Flexible** encryption mode specifically; and
   GitHub's Pages documentation contains no mention of proxies, CDNs or
   Cloudflare at all. What is documented is the mechanism: two parties both
   terminating TLS for one hostname, and an origin that redirects HTTP to HTTPS
   sitting behind an edge that speaks HTTP to it. GitHub Pages is exactly that
   shape. Grey cloud sidesteps the question rather than answering it, which is
   the right trade for a site that already works.
6. **Ask Cloudflare's nameservers what they will answer, before anything is
   delegated to them.** This is the last reversible moment and the only proof
   in this section that does not depend on reading a table correctly.
   Cloudflare serves a pending zone on its assigned nameservers already, so the
   whole zone is queryable from outside while GoDaddy is still authoritative
   and nothing is at stake. Take the pair off the zone's Overview page:

   ```bash
   NS=<something>.ns.cloudflare.com     # either of the two assigned
   dig @$NS +noall +answer A resonate.select
   dig @$NS +short A www.resonate.select
   dig @$NS +short CNAME www.resonate.select
   dig @$NS +short TXT _dmarc.resonate.select | wc -l          # exactly 1
   for q in "AAAA resonate.select" "MX resonate.select" "CAA resonate.select" \
            "TXT resonate.select" "CNAME _domainconnect.resonate.select" \
            "A club.resonate.select"; do
     printf '%-42s %s\n' "$q" "$(dig @$NS +short $q | tr '\n' ' ')"
   done
   ```

   **The apex must answer `185.199.108-111.153` and nothing else.** If it
   answers something in `188.114.x`, `104.x` or `172.67.x`, those are
   Cloudflare's own anycast addresses and the record is still proxied,
   whatever the cloud icon looked like. `www` is the same test upside down: a
   grey `www` answers a CNAME and no A record, and a proxied one answers no
   CNAME and a pair of Cloudflare addresses, because the edge flattens it. A
   proxied `www` also grows AAAA records out of nothing, which are Cloudflare's
   and not a record anybody added, so do not go hunting for one to delete.
   Every line in the loop must come back empty.

   This is not belt and braces. Cloudflare documents that records *will be
   DNS-only until your zone has been activated*, so an orange cloud left on is
   inert and invisible right up until the delegation moves, and then it is
   neither. On 2026-08-16 this query is what caught five records still proxied
   after they had been set, checked and reported as grey. Run it, read the
   addresses, and only then go to step 8.
7. **Leave CAA alone.** There is none today, which permits any CA. If you ever
   add one it must name **both** `letsencrypt.org`, or GitHub cannot renew the
   apex, **and** `pki.goog` and `letsencrypt.org` for Cloudflare's own edge
   certificate on `club.resonate.select`. A CAA record naming only one of them
   breaks the other, and the failure is a certificate that silently stops
   renewing months later. Cloudflare's dashboard makes a CAA record trivially
   addable, and GitHub documents no renewal process at all, so this is a
   mistake that surfaces ninety days after everyone stopped watching.
8. **Change the two nameservers at GoDaddy** to the pair Cloudflare gives you,
   at Domain Portfolio → `resonate.select` → DNS → Nameservers → *I'll use my
   own nameservers*. Read the pair off this zone's own Overview page rather
   than copying another zone's: Cloudflare assigns them per zone and says they
   may differ between domains in one account. DNSSEC is off, so there is
   nothing to disable first; confirm that by checking step 1 printed no
   `DNSKEY`.
   Expect an identity check if Domain Protection is on, and note that if
   two-step was switched on less than 24 hours ago the code goes to the account
   email rather than the phone. **Save is the cutover.** There is no staging.
9. **Watch it land at the registry.** Not at a resolver, and not at the site.
   ```bash
   dig @$(dig +short NS select. | head -1) +noall +authority NS resonate.select
   dig +short SOA resonate.select
   for r in 1.1.1.1 8.8.8.8 9.9.9.9; do echo "$r: $(dig +short @$r NS resonate.select | tr '\n' ' ')"; done
   curl -sI https://resonate.select | head -3
   ```

   The first line asks the `.select` registry for the delegation it holds. It
   has no cache to answer from, so it is true within a minute of the save, and
   it is the only line here that answers the question the step is asking. The
   second names the provider now serving the zone: `dns.cloudflare.com` where
   GoDaddy said `dns.jomax.net`. The third watches the public resolvers let go
   of the old delegation, which is a matter of TTL rather than of correctness.
   The fourth proves the site did not break.

   **An earlier draft of this step could not fail**, and it is worth knowing
   why before trusting any check in this file. It read `NS` from the default
   resolver, then `A` from three resolvers, then the site. On 2026-08-16 all
   three printed exactly what they had printed the day before: `ns33`/`ns34`,
   the four GitHub addresses, `HTTP/2 200`. The addresses and the page are
   identical either side of the cutover **by design**, because the whole point
   is a move nobody notices; and the `NS` line comes from a cached delegation
   carrying GoDaddy's 3600-second TTL, so it names the old pair for up to an
   hour after the new one is live and authoritative. Every outcome that step
   could produce was consistent with both success and failure. A check whose
   only available wrong answer is *not yet* is a check that talks you into
   rolling back a move that already worked.

> **Rollback**, and it is weaker than the earlier draft claimed. Point the
> nameservers back at `ns33`/`ns34.domaincontrol.com`. That much is a click.
> What is **not** documented anywhere at GoDaddy is whether your zone survives
> having the nameservers pointed away, or for how long, so *the GoDaddy zone is
> not deleted by the move* was an assumption written as a fact. Assume the
> rebuild instead: the exported zone file from step 1 is the rollback, and the
> import path adds records rather than replacing them and fails outright on a
> conflict, so budget time to fix it by hand. Cheap to prepare, expensive to
> improvise.

Wait for the Cloudflare dashboard to report the zone **Active**, not Pending.
This can take up to 24 hours and the next step fails without it. Nothing in
section 3 can be started early: the custom domain, the certificate and every
proof in it depend on the zone being live.

**The registry answering is not the dashboard saying Active**, and step 9 going
green is not permission to start section 3. Cloudflare checks the delegation on
its own schedule, so the zone can be delegated, serving and correct from
outside for some time before the Overview page catches up and the account
believes it. The gate on section 3 is the word on the page, because that is
what the custom-domain and certificate machinery reads.

**One honest consequence for THREATS**: Cloudflare becomes authoritative for the
whole domain, so their resolvers see lookups for the site and not only for the
club. It is a swap of GoDaddy for Cloudflare rather than a new observer, and
Cloudflare already sees every member's address at the club, but it should be
written down rather than noticed later.

---

## 3. Cloudflare: the worker

Two things have to be true before the first command, and neither says so until
you are already committed to the next one.

**Install the pinned wrangler.** Every `wrangler` line below this point in the
file is written `npx wrangler`, and every one of them is a command in `club/`.

```bash
cd club
npm ci
npx wrangler --version      # must print 4.123.0
```

`wrangler` is an exact devDependency of `club/package.json`, recorded in
`club/package-lock.json` with its integrity hash, so `npx` finds that copy and
no other. It lives here rather than at the repository root so that the CI job
which installs a browser tree does not also install this one. A bare
`wrangler`, or an `npx wrangler` run from somewhere else, is whatever was
published that morning, pointed at a worker whose `compatibility_date` is
fixed.

**Be authenticated.** Every `wrangler` line below fails without it.

```bash
npx wrangler login          # or: export CLOUDFLARE_API_TOKEN=...
npx wrangler whoami
```

If that account list has more than one entry, put `account_id` at the top of
`wrangler.toml`, above the `[observability]` header, before deploying. Above
that header and not below it: this file's own comments record what happened
the last time a bare key was written under a table header, which is that the
KV binding silently became a variable. Wrangler will otherwise ask, and a
deploy that lands in the wrong account is a second club nobody knows about.

**Enable R2 on the account.** It needs its terms accepted and a payment method
on file before `r2 bucket create` will answer, even entirely inside the free
allowance. Do it now rather than meeting it below, because the wall stands one
command in front of a choice that cannot be undone, and meeting it there is how
the flag gets dropped from a hurried retry. Nothing here needs a paid Workers
plan; the Durable Objects in `wrangler.toml` are declared `new_sqlite_classes`,
which the free plan allows. The proof it worked is `npx wrangler r2 bucket
list` answering with an empty list instead of `[code: 10042]`, which is a
better check than the dashboard looking right.

```bash
cd club
npx wrangler kv namespace create BOX      # copy the id into wrangler.toml
npx wrangler r2 bucket create resonate-club-vaults -J eu
```

**Why `-J eu` and not `--location weur`.** Decided 2026-08-16, against the
earlier draft of this file, which offered the location hint first. Cloudflare
uses the word guarantee for exactly one of the two: *Jurisdictional
Restrictions guarantee objects in a bucket are stored within a specific
jurisdiction*, against *Location Hints are a best effort and not a guarantee,
and they should only be used as a way to optimize performance*. The hint is
also close to a no-op here, and the earlier draft had the mechanism wrong: with
no flag at all the placement is neither random nor American, it is *the closest
available region to the create bucket request based on the location of the
caller*, and the caller is in Switzerland. So the hint buys a written form of
what would probably happen anyway, while the restriction buys a sentence that
can go in a privacy notice. Both are equally permanent, so there is no cheaper
option to defer to, and they cannot be combined: wrangler refuses with *Provide
either a jurisdiction or location hint - not both*, before it calls the API.

It costs three features and this club uses none of them: R2 Data Catalog, local
uploads, and Logpush writing to the bucket natively. The worker reaches R2 only
through `env.VAULTS`, so no S3 endpoint, no presigned URL and no public bucket
is in play. A club that wanted any of the three would have to choose the other
way.

It also costs the placement, and that is worth seeing rather than assuming.
`bucket info` reported `location: EEUR` on the day: Cloudflare put the bucket
in its Eastern Europe region, which is consistent with the guarantee because an
EU member state sits in that region, and which is further from Switzerland than
the `weur` the discarded option would have asked for. A jurisdiction says which
laws reach the bytes, not which datacentre is nearest. For a vault written on a
save and read on a restore that is a trade worth making; for anything on a
request path it would not be, and the honest reason it is fine here is that
almost nobody is waiting on it.

**Three traps, and wrangler sets the first two of them itself.**

- On success it prints a configuration snippet with **no `jurisdiction` line**,
  and with the binding renamed to `resonate_club_vaults`. Pasting it points
  `VAULTS` at a bucket in the default jurisdiction that does not exist, and the
  deploy fails on an invalid jurisdiction. The line `jurisdiction = "eu"` under
  `[[r2_buckets]]` is written by hand or not at all.
- `wrangler r2 bucket list` and `bucket info` pass the jurisdiction straight
  through, so **without `-J eu` they both report the bucket is not there**.
  That includes the empty-list check three paragraphs above, which stops
  meaning *R2 is enabled* the moment the bucket exists.
- `bucket info` reports **storage metrics and not the store**. On 2026-08-16 it
  said `object_count: 0` and `bucket_size: 0 B` for minutes after a seal that
  had already been read back out of that bucket by the app. Do not use it to
  prove a backup landed. What proves it is the seal's own answer, since the
  byte count the club reports comes from `put.size` at `club/src/worker.js:456`
  and a failed put is answered 400 rather than a size, and after that a read
  back through `GET /vault`, which answers 503 when the pointer names an object
  the store does not have.

> **No rollback.** *Once an R2 bucket is created, the jurisdiction cannot be
> changed*, and a location hint is *only honored the first time a bucket with a
> given name is created*. The only migration is copying every object into a new
> bucket, which for a club that cannot read what it holds means re-uploading
> ciphertext it must not lose or mis-address. Super Slurper does document an R2
> to R2 move across jurisdictions, but it does not preserve ETags and it is an
> API job rather than a dashboard click. Decide before the command, and say the
> answer in the privacy notice.

**What it does not buy**, because a privacy notice that overstates this is
worse than one that says nothing. EU is not Switzerland, and there is no `ch`
jurisdiction: the list is `eu` and `fedramp`. The guarantee is about where
objects are **stored**, not where requests are handled or where operational
metadata and logs are kept. Cloudflare, Inc. is a United States company and the
contracting processor either way, so this removes no third-country transfer and
no safeguard obligation. What it removes is the guessing.

Then edit `club/wrangler.toml` and replace the one placeholder left:

- `id = "PUT-THE-ID-HERE"` under `[[kv_namespaces]]` → the id just printed

`STRIPE_PRICE` under `[vars]` is **already filled**, with the sandbox Price id
from section 1, committed rather than left loose. Check it is the id you made
and not one from an earlier attempt. Section 6 is where it changes, and it is
the only place it changes.

**Then, before deploying, read the bindings back:**

```bash
npx wrangler deploy --dry-run --outdir=/tmp/club-build
```

It prints a table. Confirm all four resolve: `env.BOX` as a **KV Namespace**,
`env.VAULTS` as an **R2 Bucket**, `env.VAULT` and `env.METER` as **Durable
Objects**. This is not ceremony. A `[vars]` table written above the KV
declaration once turned that whole binding into an environment variable named
`kv_namespaces`, with no `env.BOX` at all, and the only symptom would have been
a 500 on the first request from the first person who ever paid. A test now
guards the same thing from the repository side, but the dry-run is what proves
it against the platform.

**Commit that id before deploying, on whatever branch this work is on.** It is
an identifier and not a secret: it names a namespace inside one account and is
useless to anyone who cannot already reach that account, which is why Cloudflare
puts it in the configuration file rather than in `wrangler secret`. What it is
not is reproducible. A live worker running on an id that exists nowhere in git
is a club nobody can redeploy, including you, and the id is recoverable only
from an account you might be locked out of on exactly the day you need it.
Section 5's rehearsal commit is not a home for it: that branch gets deleted.

```bash
npx wrangler deploy
```

**Set the secrets.** Generate the mint secret first and put it somewhere safe
before it goes in:

```bash
openssl rand -hex 32          # write this down somewhere permanent, first
npx wrangler secret put MINT_SECRET
npx wrangler secret put STRIPE_SECRET      # the sandbox restricted key
```

> **No rollback.** `MINT_SECRET` is not a rotatable credential. Every membership
> key is derived from it, and each member's vault is addressed by that key.
> Setting a new one does not fail loudly: it re-keys every member at once, their
> stored key stops resolving, and a recovery hands them a different key over an
> empty vault while their envelope sits in R2 addressed by nothing. It is the
> same value in sandbox and live. Set it once, ever. The worker keeps a
> fingerprint and refuses to mint if it changes, which turns a silent
> catastrophe into a loud outage, but it cannot undo one. Step 5b proves the
> copy you wrote down is the value the worker holds; do not skip it.

**Attach the custom domain**, as gated sub-steps rather than one click:

1. The zone reads **Active**.
2. Check for any existing `club.resonate.select` record and delete it. A custom
   domain cannot be created over an existing CNAME. Ask the zone's own
   nameservers rather than reading the dashboard table, which is the lesson
   section 2 step 6 already paid for:
   ```bash
   for t in A AAAA CNAME TXT; do dig @maciej.ns.cloudflare.com +short $t club.resonate.select; done
   ```
   All four empty is the pass.
3. **Declare it in `wrangler.toml` and deploy**, rather than attaching it in
   the dashboard:
   ```toml
   routes = [
     { pattern = "club.resonate.select", custom_domain = true }
   ]
   ```
   It goes above every `[table]` header, for the reason the KV comment in that
   file gives. Then `npx wrangler deploy`. Cloudflare creates and owns the DNS
   record either way, read-only and proxied, and you never make one by hand.
   What changes is that the club's address lives in the repository instead of
   only in a dashboard, and every later deploy re-asserts it: the same argument
   this file makes about the KV namespace id, applied to the one string the
   page's `connect-src` and `js/club.js` also have to agree on. If a record
   already exists the deploy refuses with *Custom Domains already exist for
   these domains* rather than overwriting anything.
4. Watch SSL/TLS → Edge Certificates until the certificate for that hostname
   reads **Active**. Most validations finish inside five minutes; it is not
   instant, and the worker answers nothing until it is done. What gets
   presented is Cloudflare's universal certificate, whose subject reads
   `CN=resonate.select` and whose SAN is `DNS:resonate.select,
   DNS:*.resonate.select`, so `club` is covered by the wildcard and a subject
   line that does not name it is not a fault. Check the **apex** too, in the
   same breath: it must still present GitHub's own Let's Encrypt certificate.
   A Cloudflare certificate answering there would mean an orange cloud had
   crept back onto records section 2 set grey.
5. Prove it, **and not through the system resolver.** This runbook sets the
   trap itself: step 2 asks for a hostname that does not exist yet, and any
   recursive resolver asked that question caches the NXDOMAIN. Cloudflare's SOA
   sets negative caching to 1800 seconds, so half an hour is the floor, not the
   ceiling: on 2026-08-16 a forwarding resolver on the machine, Tailscale's
   MagicDNS, was still answering NXDOMAIN for `club.resonate.select` **two
   hours** after the deploy, while resolving the apex of the same zone
   perfectly. The symptom is `curl: (6) Could not resolve host` and a reported
   `000`, which looks precisely like a custom domain that never attached.
   Resolve by hand and ask the worker directly:
   ```bash
   IP=$(dig @1.1.1.1 +short A club.resonate.select | head -1)
   for p in /membership /; do
     curl -s -o /dev/null --resolve "club.resonate.select:443:$IP" \
       -w "$p %{http_code}\n" "https://club.resonate.select$p"
   done
   ```
   **401 from both is the pass**, and this line used to say 404 for the second,
   which the worker cannot produce here. Any method except OPTIONS, on a path
   the worker does not route, falls through to the member gate, which answers
   `no key` with 401. The 404 further down its own code is real but sits below
   that gate, so only a request already carrying a key the club recognises can
   ever see it. OPTIONS is the exception and is answered 204 with the CORS
   headers before routing happens at all. A 500 from either means a binding did
   not resolve; go back to the dry-run.
6. **Ask the desk which mode it is in**, which is the one question this runbook
   used to answer only from memory:
   ```bash
   curl -s --resolve "club.resonate.select:443:$IP" https://club.resonate.select/desk
   ```
   It answers `{"live":false,"price":"price_...","ready":true}`. All three have
   to be checked and the first is the one that matters. `live` must be **false**
   while `TESTING` in `js/club.js` is `true`: that constant is what makes the app
   tell a person, in the moment before they type a card, that no money changes
   hands, and it is a claim about this worker that until now nothing could
   verify. The two facts live apart, one in git and one in `wrangler secret put`,
   and the failure between them is silent and runs one way. `admits` already
   refuses a test session against a live desk, so anybody who obeys the app and
   types a test card is turned away; anybody who types a real card produces a
   live session, passes every check there is, and is charged for a year having
   just read that nothing is charged.

   `price` must equal `STRIPE_PRICE` in `wrangler.toml`, which catches the thing
   that file's own comment warns about: the sandbox and live ids are different
   strings and neither of them says which it is. `ready` false means one of the
   three secrets is missing, and that is the state `club/src/stripe.js` notes
   cannot otherwise be told from a refused card.

   None of it has to be remembered. The club room asks the same question before
   it offers anybody a card, and withholds the door when the answer disagrees or
   does not arrive; the smoke job asks it on every release and fails the release
   on any of the four mismatches. This step is for the minute after a deploy,
   before either of those has run.

---

## 4. Stripe: the webhook

Create an endpoint at `https://club.resonate.select/stripe` subscribed to
exactly six events:

```
checkout.session.completed
checkout.session.async_payment_succeeded
invoice.paid
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Workbench creates an **event destination** with an `ed_` id rather than the
classic `we_` endpoint the older Dashboard made. That changes nothing about the
signature and everything about the list above, because the wizard offers every
event in the account as a single press and someone always takes it. Select the
six. On 2026-08-16 the destination that was actually delivering here was
subscribed to 241, which works and means every meter reading and every product
edit in the sandbox arrives at the club to be answered and thrown away.

The second one cannot fire today and is subscribed anyway. The worker already
treats it exactly as it treats `checkout.session.completed`, because both mean
the same thing, and `createCheckout` sends `payment_method_types[0]=card`, so
settlement is immediate and this event never arrives. Note where the trigger
actually is: because that parameter is sent explicitly, Stripe ignores whatever
methods are enabled in the Dashboard, so turning one on there changes nothing.
What would change it is loosening or removing `payment_method_types` in
`club/src/stripe.js`. It costs one checkbox now, and left off, the first day
after that edit is the day a member pays, settles two days later, and is handed
nothing at all, with the handling for it already written and merely never
reached.

Set the endpoint's **API version to `2025-03-31.basil`**, the version the worker
is written and tested against. Events are delivered in the endpoint's version,
not the version your API calls pin, and the two moving apart is how a renewal
quietly stops arriving.

Then, in the same minute:

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

**The value starts `whsec_` and is about 38 characters, and nothing else in the
Dashboard is this secret.** Workbench keeps the restricted API key behind a
click-to-reveal control that looks the same one tab away, and an `rk_test_51`
key is 107 characters that verify nothing and fail exactly the way a stale
signing secret fails: 400, every delivery, no other symptom. Read the first six
characters before pasting. If they are not `whsec_`, that is the whole bug, and
on 2026-08-16 it was the whole bug twice in a row.

**The secret belongs to one destination, and Stripe will not hand it back.**
A URL with two destinations pointed at it has two secrets, only one of which
verifies the deliveries that are actually arriving, and the Dashboard will show
you either one without saying which. The API is no help here:
`include[]=webhook_endpoint.signing_secret` is accepted only when the
destination is created, retrieve and list and update accept
`webhook_endpoint.url` alone, and there is no rotate call. If the reveal is
gone, roll the secret from the destination's own menu with delayed expiry and
take the value it shows once. During the overlap Stripe sends two `v1` entries
per delivery and `verifyWebhook` accepts either, so rolling is safe with
deliveries in flight.

Until it is set, every delivery is answered 400, and a sandbox event is retried
only three times over a few hours. It is not lost when the retries stop: Stripe
keeps an event resendable by hand for 15 days from the endpoint's event page,
and for 30 days with `stripe events resend <event_id> --webhook-endpoint=<id>`.
That 30-day window is why the worker's `ev:` markers expire at thirty days and
not at three.

**Verify a delivery**, do not assume one. Bind the CLI to this sandbox first:
`stripe trigger` fires into whichever environment the CLI is authenticated
against, and no flag on `trigger` names a sandbox.

```bash
stripe login    # press Enter, select THIS sandbox in the browser, Allow access
stripe trigger checkout.session.completed
```

Confirm the endpoint's delivery log shows **200**, and then confirm it from
this side as well, because the log is a report and KV is the thing itself:

```bash
npx wrangler kv key list --binding BOX --remote | grep ev:
```

One `ev:` row, written by the worker after the work rather than before it. No
row means no delivery has ever been accepted.

**What that 200 proves, and what it does not.** It proves the signature
verified, and nothing else. The CLI's fixture is a one-time `mode: payment`
session for a throwaway product it creates on the spot, not a subscription at
the club's price, so the worker refuses it at its first check and logs
`hook.refused reason=mode` before answering 200. That refusal is the correct
answer. Only a **400** is a failure here, and it means the signing secret is
wrong.

**When it is 400, do not go looking in the worker.** The club verifies by hand
rather than with an SDK, which makes the verifier the first thing suspected and
the wrong thing suspected. Stripe's own v2 path in `stripe-node` calls the same
`verifyHeader` as its classic path, keyed on the whole secret including the
`whsec_` prefix, over `t` and a dot and the raw body, with 300 seconds of
tolerance, and the manual procedure Stripe publishes has no branch in it
either. Snapshot and thin change the body and never the signature. A refusal
with the clock skew near zero and a single `v1` entry is the key rather than
the code, every time.

The membership path itself is proved in step 5 by a real subscription
checkout. The fixture also leaves a product and price behind in the sandbox and
an `ev:` marker in KV, both of which step 5b clears.

---

## 5. Walk the whole thing, from a local build

The deployed site cannot reach the club yet: `index.html`'s `connect-src` does
not name the club origin, and a `clubUrl` setting changes the address but not
the policy. So this rehearsal runs against a **local** build that is never
pushed.

**And the worker will not answer it until `SITE` says so.** `cors()` sets
`access-control-allow-origin` only for `siteOf(env)`, and
`club/test/checkout.test.mjs` pins `http://localhost:5178` in the list of
strangers that must get no allowance. The same setting is the `success_url`, so
it also decides where Stripe returns the browser after payment: to the origin
holding the join secret, or to the deployed site, which has neither the secret
nor a club to call. Without this swap the walk fails on its first click, and
then fails a second way that is silent.

So, in `club/wrangler.toml`, temporarily:

```
SITE = "http://localhost:5178"
```

```bash
npx wrangler deploy
git switch -c rehearsal
```

In `js/club.js` set `CLUB_URL = 'https://club.resonate.select'` and
`PRICE = 'CHF 48'`; in `index.html` add that origin to `connect-src`. Then
`node tools/dev.mjs` and drive it at `http://localhost:5178`.

**Before the first click, prove the browser can resolve the club**, because a
browser has no `--resolve` and this is where section 3's poisoned cache comes
back for you. Section 3 step 5 works around the stale NXDOMAIN by resolving by
hand; nothing here can. The symptom is `become a member` doing nothing at all,
with `net::ERR_NAME_NOT_RESOLVED` in the console and no request leaving the
page, which reads like a broken button rather than a DNS answer from two hours
ago. Check it first:

```bash
dig +short A club.resonate.select        # the SYSTEM resolver, not @1.1.1.1
```

An empty answer means fix it before walking, not debug the button. Flushing the
machine is the obvious move and on 2026-08-16 it was the wrong one: the stale
answer was not on the laptop at all. The chain was browser, macOS, Tailscale
MagicDNS with no resolvers of its own, and then the home router at
`192.168.1.1`, which was serving `resonate.select` and `www.resonate.select`
correctly and `NXDOMAIN` for `club.resonate.select` alone, hours later. Find
which link is lying before touching any of them:

```bash
dig @192.168.1.1 +short A resonate.select        # the router: works
dig @192.168.1.1 +short A club.resonate.select   # the router: empty, so it is the one
```

The narrowest fix is one line, scoped to one name, and changes no network
setting:

```bash
echo '188.114.96.12 club.resonate.select' | sudo tee -a /etc/hosts
```

TLS still verifies through it, because the edge certificate's SAN is
`*.resonate.select`. **Take it out again after step 7**, or this machine is
pinned to one anycast address for good:
`sudo sed -i '' '/club\.resonate\.select/d' /etc/hosts`.

Walk all of it: press **become a member**, pay with `4242 4242 4242 4242`, come
back, get a key, type a phrase, back up, read the backup, press **end the
membership** and confirm Stripe's portal opens and can cancel, then confirm the
club room says the membership is leaving.

**The key proves the door and not the webhook**, and that difference is the
whole of section 4. `/door` opens the membership itself, out of the session it
fetches from Stripe, so a paid checkout hands back a key, a standing and a year
whether or not a single delivery has ever been accepted. Everything the walk
shows up to this point is the door's work alone. So stop here and ask KV what
it heard:

```bash
npx wrangler kv key list --binding BOX --remote | grep ev:
```

No `ev:` row after a payment means the webhook is dead and only the door is
alive, which is not a small state to be in: renewals never extend the date,
lapses never register, and the cancellation in the paragraph above happens at
Stripe and nowhere else. On 2026-08-16 the walk arrived here with a working
key, a sealed backup of 59,921 bytes and an empty `ev:` namespace, and the
cancellation then went through at Stripe while the club went on holding
`standing: good` and `leaving: false`.

When it is empty, the cause is the one section 4 names, and it is invisible
from here because `verifyWebhook` refuses before it logs anything: a wrong
`STRIPE_WEBHOOK_SECRET` looks like silence on this side rather than like an
error. Two silences that read alike in KV, told apart without the dashboard:

```bash
npx wrangler tail --format pretty
```

An endpoint that is not delivering prints nothing at all. An endpoint that is
delivering and being refused prints one `POST .../stripe - Ok` line with no log
line beside it, because `Ok` is the worker not throwing rather than the answer
it gave, and the refusal at `club/src/stripe.js:115` returns ahead of the first
`say()`. One line and no company means the secret. Copy it again from the
endpoint that is actually delivering, set it, fire one event, and do not go on
until the `ev:` row is there.

On the day it was the secret twice, and neither paste came from the destination
that was delivering. The first was the right kind of value taken from the wrong
one of the two destinations pointed at this URL. The second was not a signing
secret at all. What ended it was the shape check section 4 now opens with, and
once the right value was in, the next event was applied and the room said
`leaving at the period's end` within a minute.

**Then give KV about twenty seconds before believing it.** The read is
eventually consistent and goes on answering with the record from before the
event for a while after the worker has already written the new one. On
2026-08-16 the first read after the cancellation came back `leaving: false`
with the sequence unmoved, and the same command twenty seconds later came back
`leaving: true` with it advanced. A runbook that says check KV without saying
wait hands you a false negative at the exact moment you are ready to believe
one:

```bash
npx wrangler kv key get --binding BOX --remote "member:<the key from the room>"
```

That record is also the only place the ordering guard is visible. `seq` is what
stops a late retry from writing older state over newer, and until a first
delivery is accepted it has never been written at all, which means the guard
has never once run. Watch it move.

The tail is where an over-subscribed destination proves itself, rather than KV:
`{"e":"hook","type":"billing_portal.session.created","outcome":"ignored"}` is
an event nobody asked for, verified, marked handled and dropped. That is the
correct answer and it is also the argument for narrowing the list to six.

Then, in a second browser holding **only the key and the phrase**, restore.

Keep this branch until after step 7, and commit on it rather than leaving the
edits loose:

```bash
git commit -am rehearsal
```

Uncommitted, those edits follow you back to `main` and the branch you delete is
empty, leaving a live-pointing `CLUB_URL` on `main` looking deleted. When step 7
is done: `git switch main && git branch -D rehearsal && git status`, and
`git status` must be clean.

Put `SITE` back to `https://resonate.select`, deploy again, and prove it before
step 6:

```bash
curl -s -i -X OPTIONS https://club.resonate.select/membership \
  -H 'Origin: https://resonate.select' | grep -i access-control-allow-origin
```

That header must come back. While `SITE` is localhost the real site cannot reach
the club at all, which is harmless before step 8 and fatal after it.

### 5b. Clear the rehearsal out, and prove the mint secret

The sandbox walk wrote real rows into the production KV, real objects into R2
and real Durable Objects. Left there, the test membership stays `good` for a
year: after the live secret swap, its cancellation event fails signature
verification and nothing ever ends it.

```bash
NS=<BOX id>     # the id in wrangler.toml, not the binding name

npx wrangler kv key list --remote --namespace-id=$NS \
  | python3 -c "import sys,json; [print(k['name']) for k in json.load(sys.stdin)]"
```

**`--remote` is not optional and its absence is silent.** Without it wrangler
answers from the local simulator and prints `[]` for any namespace id at all,
including one that does not exist, so this whole step passes while deleting
nothing.

**Burn the vault from the app first** (**delete both backups**), and delete the
keys afterwards. The order is the whole of this step, and getting it the other
way round is silent.

The club authorises that delete against the `member:` row in KV, not against
the key in your hand: `memberOf` reads the row, `standingOf` returns `none`
when it is missing, and every member route including `DELETE /vault` sits below
a gate that answers 401 `unknown key` (`club/src/worker.js:362-371`). The app
shows that as *the club did not answer*, and it looks like a bad afternoon
rather than a refusal. Meanwhile the Durable Object stays alive and the R2
objects stay in production under names only that Durable Object knows, which
nothing else in this file cleans and no later step notices. The check below
(**exactly one key, `mint:fp`**) passes either way, so you would finish
believing the rehearsal was cleared.

Burning first is always allowed: only a standing of `none` is refused, and
`good`, `lapsed` and `left` may all delete, because the envelope is theirs.

Then the keys, one at a time: every `member:`, `sub:` and `ev:` row.

```bash
npx wrangler kv key delete --remote --namespace-id=$NS "member:tc_..."
```

Leave `mint:fp` alone: that is the fingerprint, and it is the same secret in
both modes. Then list again. **The right answer is exactly one key, `mint:fp`,
and not an empty list.** An empty list means you are still reading local
storage and nothing has been cleaned.

**Then prove that the value you wrote down is the value the worker holds.** This
is the one failure in this file that is both irreversible and completely
undetectable: `wrangler secret put` echoes nothing and confirms nothing, so a
dropped character produces no symptom for years, and surfaces only on the day
the worker must be rebuilt, when every membership key ever minted is
unreproducible and every vault in R2 is addressed by nothing.

```bash
printf '%s' 'PASTE-WHAT-YOU-WROTE-DOWN' | node ../tools/mint-key.mjs - --fingerprint
npx wrangler kv key get mint:fp --remote --namespace-id=$NS
```

Those two must be the same string. The tool calls `fingerprintOf` in the
worker's own `club/src/validate.js`, which is the same function the worker
calls to write that value, so the two cannot drift: the label and the
truncation exist once. The `-` is required and means the secret arrives on
stdin; without it the tool reads `MINT_SECRET` from the environment and never
touches the pipe. Either form works, and `echo` and `printf` agree because one
trailing newline is stripped, though a trailing space is part of a secret and
will change the answer.

The same tool is the recovery procedure, for the day a member has paid and
lost the secret their device was holding. Take the subscription id off the
subscription in Stripe:

```bash
printf '%s' 'THE-MINT-SECRET' | node ../tools/mint-key.mjs - sub_1234
```

That prints the member's key, which is the key they already have a vault
under. It reads nothing, writes nothing and reaches no network. The mint
secret is the whole of the club's key material, so this is a deliberate
operation against a subscription you can see at Stripe, and never a second
credential left lying about for convenience.

If they differ, the copy is wrong, and this is the last moment it can be fixed
for nothing: nobody has paid yet, so delete `mint:fp`, set the secret again from
a value you have verified, and walk step 5 once more. After a member exists there
is no fix, not a rotation, not a migration, not a support case.

---

## 6. Live

**The account has to be activated for live payments before any of this exists.**
Business identity, address, a payout bank account, and the public business
details Stripe requires. Card must come out of it as an enabled method, because
the club's checkout offers nothing else. This is not a five-minute step and it
is not something the switcher does: nothing below is reachable until it is done,
and it can sit waiting on someone else for days.

Repeat, in live mode, the things that are per-mode and therefore unproven. Live
mode is reached with the environment switcher, the same as the sandbox was; a
sandbox is a separate copy of the account rather than a view of the live one, so
there is no *View test data* toggle to turn off from inside it.

- the product and its one price, **a new Price id**

  > **No rollback.** This is the Price a real card is charged against. Amount,
  > currency, interval and tax behaviour can never be edited afterwards, in live
  > mode any more than in sandbox. CHF 48, yearly, `inclusive`. Check both the
  > amount and the tax behaviour before saving.

- the customer portal: Activate, confirm **Cancel subscription** is on, confirm
  cancellation is at period end, Save. A sandbox portal proves nothing about
  live, and a member who cannot cancel is the worst thing this club could ship.
- the Adaptive Pricing toggle
- a live restricted key with the same three resources. This is the operation in
  this runbook most likely to be got wrong twice, because the checkboxes are
  ticked again from scratch in a different environment. Re-run **all three**
  proofs from 1b against it, including the portal call.
- a live webhook endpoint carrying **the same six events**, at the same API
  version, and its signing secret
- **disable the sandbox webhook endpoint**, so it stops failing against a worker
  that no longer holds its secret
- **The public business details, and the statement descriptor.** Nothing in
  this repository can set these and nothing in it can check them, which is why
  they were missing from every earlier draft of this file. They are the only
  part of the purchase the club does not render itself.

  The statement descriptor is what appears on the card statement a year later,
  next to a charge the buyer has forgotten agreeing to. Set it to something a
  person recognises without thinking, and **keep it to ten characters**:
  `RESONATE`, which is eight. Never a company name a buyer has never seen. A
  descriptor that does not match the site is how an honest annual renewal
  becomes a chargeback.

  **Ten, not twenty-two, and the Dashboard will not tell you.** Stripe accepts
  a static descriptor of five to twenty-two characters, but a card payment uses
  a *prefix*, which is two to ten. Set the static value and no prefix, as this
  club does, and Stripe uses the static value as the prefix and cuts whatever
  is past ten. So `RESONATE.SELECT` is fifteen characters, saves without a
  complaint, and reaches the statement as `RESONATE.S`. Latin letters only, and
  none of `< > \ ' " *`.

  In the public business information, set the support address to
  `resonateselect@proton.me`, which is the address `TERMS.md` and `PRIVACY.md`
  both give, and the website to `https://resonate.select`. Give Stripe the
  terms and privacy links as well:

  ```
  https://resonate.select/read.html?d=terms
  https://resonate.select/read.html?d=privacy
  ```

  Open both in a private window before saving them. They are reachable only
  once the deploy carrying those documents has landed, and a Checkout page
  linking to a 404 is worse than one linking to nothing.

  > Worth deciding rather than defaulting: Checkout can also require the buyer
  > to **tick a box accepting the terms**, rather than merely linking them.
  > That is `consent_collection[terms_of_service]` on the session, so it is a
  > change to `club/src/stripe.js` and a test, not a dashboard setting. It is
  > the difference between the terms having been published and the terms
  > having been accepted, which is the difference that matters if a renewal is
  > ever disputed. Not done here, because it is a decision.

- **Customer emails: three switches, and they are not on one page.** This is
  the item most likely to be left half done, because the obvious page holds two
  of the three and looks complete.

  - The receipt is **Settings → Business → Customer emails**
    (`dashboard.stripe.com/settings/emails`), where **Successful payments**
    sits under *Payments*. Nothing about receipts lives under Billing.
  - Failed payments and upcoming renewals are **Settings → Billing →
    Subscriptions and emails**
    (`dashboard.stripe.com/settings/billing/automatic`), under *Email
    notifications and customer management*: **Send emails when card payments
    fail**, which Stripe also surfaces on the revenue recovery emails page,
    and **Send emails about upcoming renewals**, whose lead time is a separate
    field under *Prevent failed payments → Upcoming renewal events*.

  Turn on all three, in live mode, and do the receipt last, because it is the
  one this path does not walk past. The sandbox proves none of it: Stripe does
  not send customer emails there automatically.

  The club stores no email address by design, so Stripe's own mail is its only
  channel to a member. With these off, a member gets no receipt, no notice when
  a card fails before the subscription lapses, and no warning before the
  renewal a year later: an unannounced annual charge on a statement the buyer
  cannot match to a receipt, which is how disputes are made.

Then:

```bash
# STRIPE_PRICE lives in wrangler.toml and only changes on deploy;
# secrets change immediately. Edit the file FIRST, then deploy, then swap.
#   1. put the LIVE price id into wrangler.toml
npx wrangler deploy --dry-run --outdir=/tmp/club-build   # read the bindings again
npx wrangler deploy
npx wrangler secret put STRIPE_SECRET           # live restricted key
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # live signing secret
```

**`MINT_SECRET` is not in that list.** It does not change. It never changes.

### Before anything can go wrong quietly

There is no team, so the only monitor that exists is the one turned on now. The
worker answers **500 on purpose** when it wants a delivery again, which is
correct behaviour and, from Stripe's side, indistinguishable from a broken
endpoint. A live key missing Subscriptions Read makes every
`checkout.session.completed` return 500 forever; Stripe warns, then disables the
endpoint, at which point `invoice.paid` and `customer.subscription.deleted` stop
too, so memberships neither renew nor end and the club goes on charging people
it will no longer serve.

- In Stripe, there is nothing to turn on: the mail about a failing webhook is
  automatic, and Communication preferences carries no entry for it. What is
  worth checking is the address it goes to, which is the one your Stripe login
  receives mail at and not necessarily the public support address set above.
  Make sure that is an address you read daily.
- In Cloudflare, add a notification on the worker's error rate.
- Once a week for the first month: Developers → Webhooks, and look at the error
  rate on the live endpoint. Nothing else in this club reports on itself.

### If you stop here

After this section, `club.resonate.select` holds a live key and a live price.
CORS restricts browsers, not `curl`: anything that can POST a valid commitment
gets a real live Checkout Session, in front of no published terms. If you are
not going straight on to steps 7 and 8, close it before you stop:

```bash
npx wrangler secret delete STRIPE_SECRET
```

Set it again when you come back. This is the one state in this file that should
not be left overnight, and the reason is not only the shut door: `/portal` is
guarded on the same secret and answers 503 while it is gone, so nobody can
leave either. Before step 7 that costs nothing, because the only member is you.
After it, a member who wants out cannot get out from the club room, and ending
them is yours to do by hand in the Stripe Dashboard.

---

## 7. You buy first, from the local build

Same rehearsal branch, pointed at the live worker, with a real card. The `SITE`
swap from step 5 applies again. If Stripe's live mode refuses a
`http://localhost` `success_url`, the door still works and only the redirect is
lost: take the `cs_` id from the payment in the Dashboard and paste it into the
club room, which accepts a pasted session.

Walk the whole flow again including the portal cancellation and the second
browser.

This is deliberately before the public switch. Everything specific to live mode
is unproven until now, and the alternative is discovering it with a stranger's
money.

**Then open the live endpoint's delivery log and count.** That one purchase must
show `checkout.session.completed`, `customer.subscription.created` and
`invoice.paid`, all 200. Do not count the deliveries and do not expect exactly
three: `customer.subscription.updated` is documented as firing when a
subscription is started as well as when it is changed, so one or two of those
are correct and mean nothing is wrong. What matters is that those three are
there. `invoice.paid` is the
renewal path, and this is the only time before the renewal itself that it can be
seen working. If it is not in the log, the endpoint's event list is wrong. Fix it
now: the next chance to notice is a year away, and the symptom then is every
member the club has lapsing on the same morning, each discovering it as a failed
backup.

Write the subscription's `current_period_end` down, and put a calendar reminder
eleven months out to check that the renewal invoice was paid and the endpoint
answered it.

**Then put `SITE` back, and prove it. Do not go to step 8 without this.** The
swap above left the worker answering `http://localhost:5178` and nothing so far
has undone it. Step 5 restores it too, but that restore is scoped to step 5 and
is already spent by the time you arrive here.

```bash
# in club/wrangler.toml
SITE = "https://resonate.select"
```

```bash
npx wrangler deploy
curl -s -i -X OPTIONS https://club.resonate.select/membership \
  -H 'Origin: https://resonate.select' | grep -i access-control-allow-origin
```

That header must come back naming `https://resonate.select`. This is the worst
thing in this file to leave undone, because it is the last step of a long day
and it fails in the direction of taking money. `SITE` decides two things at
once: which origin the worker allows, and where Stripe returns the browser
after payment. Left at localhost when step 8 lands, no member's browser can
reach the club at all and every payer is returned to an address that does not
exist on their machine. Money taken, nothing given, for everyone, until
somebody notices.

The switch commit's own CI asks this question too, once `CLUB_URL` is filled:
the smoke job runs the same preflight. It is a second pair of eyes and not a
replacement for this one, and it is worth being exact about how weak a second
pair it is. `smoke` needs `deploy`, and `deploy` waits for publication, so by
the time that preflight runs the bytes are already live. It fails the run, not
the deploy. This curl, here, is the one that runs before anything is public.

**Commit the live Price id**, which is the one value this runbook edited into
`club/wrangler.toml` and has nothing holding it. Branch, pull request, green,
merge, like anything else. A live worker running on an id that exists nowhere
in git is a club nobody could ever redeploy, including you.

The KV namespace id used to be listed here too, and it no longer is: section 3
commits it at the moment it is created, which is the only moment it is
guaranteed to be on screen. An earlier draft left it loose until here and then
warned that step 5's `git commit -am rehearsal` had swept it onto a branch
about to be deleted, so that deleting the branch took the id with it. Committing
it where it is made removes the hazard instead of describing it.

---

## 8. The switch

The last section of this file is not a postscript. Nothing above creates a beta,
and this commit makes the club purchasable by anyone who finds it.

The documents that used to be missing here now exist and are reachable:
`TERMS.md` and `PRIVACY.md`, set for reading at `read.html?d=terms` and
`read.html?d=privacy`, linked from the how page. **What they still carry are
placeholders, and this is the commit that makes them a lie.** Fill every
`PUT-THE-` in both before opening the pull request:

- the legal name, the postal address, and the UID or VAT number if registered

The R2 bucket's location used to be on that list, pointing at section 5, which
never settles it: section 3 does, because section 3 is where the bucket is
made. It was filled there on 2026-08-16 and is no longer a placeholder.

`test/docs.test.mjs` refuses an open door that leaves any of them, and names
the file and line of each. That is the gate on the way in.

**The way out has one too, and it is the thing in this section most likely to
stop the merge.** `test/browser/read.spec.mjs` is written from the other side:
four of its five tests assert that the curtain is still up and the placeholders
are still there. *An unfinished document is not set until the word is given*
and *the wrong word is refused* both wait for `#readGate` to be visible; *the
word opens it* types `atlas` into a gate that will no longer exist; and *the
word is a curtain*, the one the file's own header calls the important one,
fetches the raw bytes of `/TERMS.md` and `/PRIVACY.md` and asserts each still
contains `PUT-THE-`. This is the commit that removes both the word and the
placeholders, so all four go red, in all three engines, and `browser` never
goes green.

No ordering of commits escapes it. Filling the placeholders while the documents
are still listed in `UNFINISHED` fails `test/docs.test.mjs` in the other
direction, which is the both-ways binding working exactly as intended. So
`read.spec.mjs` is rewritten in the same commit, and rewritten rather than
deleted: what it should say afterwards is that a finished document asks for
nothing, that both are served at their own addresses, and that neither carries
a placeholder any more. It is the same test file making the opposite claim,
which is what a curtain coming down looks like in a suite.

Until then both documents sit behind a word, which is `atlas`, kept as a
digest in `js/read.js` and listed in `js/marks.js` as `UNFINISHED`. It is a
curtain and not a lock: the site is static, so `resonate.select/TERMS.md`
answers to anyone who asks for it directly, and a browser test says so rather
than letting the word look like protection. What it buys is that the
unfinished pages are not what a search engine or a passer by finds.

**Taking the last placeholder out is what takes the curtain down.** A test
binds the two together in both directions, so a document with no `PUT-THE-`
left in it fails while it is still listed, and the failure names it. Empty
`UNFINISHED` in the same commit that fills them.

One pull request, and it is the only change that makes the club purchasable:

- `CLUB_URL` and `PRICE` in `js/club.js`
- the club origin added to `connect-src` in `index.html`
- the how page rewritten so it stops saying the door is shut
- `UNFINISHED` emptied in `js/marks.js`, the `PUT-THE-` lines filled, and
  `test/browser/read.spec.mjs` rewritten to match, as above

`test/words.test.mjs` fails until the how page is rewritten, and
`test/docs.test.mjs` fails if a price is quoted without a door or a door opens
without a price. Both are the design working. Bump the version marker, open the
pull request, and merge it once `test` and `browser` are green. `main` has
required that since the first section, so this is not a push.

### Done on 17 August 2026, and the one thing that is not

The app side of the switch is written and green: `CLUB_URL` names
`https://club.resonate.select`, `PRICE` is `CHF 48`, the policy in `index.html`
names the club, the how page is in the present tense and says out loud that the
desk is a sandbox, and the two browser tests that asserted a shut door now
assert an open one. The version marker is rf118. `TESTING` stays `true`: this
opens a sandbox to friends, not a shop.

**The worker at that address is an older build and has to be deployed before
this is merged.** Asked from here on 17 August:

```
OPTIONS /membership   Origin: https://resonate.select
  -> 204, and no access-control-allow-origin at all
  -> access-control-allow-headers: authorization,content-type,if-match,if-none-match
```

Two things are wrong with that answer and they have one cause. The header list
is missing `x-cap`, and `access-control-expose-headers` is missing
`x-arrived-at`, both of which the committed worker has sent since the letterbox
landed: the running code predates letters. And no allowance is returned to
`https://resonate.select`, which means the deployed `SITE` is not what
`club/wrangler.toml` says it is, left over from a rehearsal. `siteOf` compares
the origin to `SITE` exactly, so every call from the live page would be refused
by the browser before it reached the network, and the app would report it as
the club not answering.

**Which branch it is, proved rather than inferred.** Asked again on 17 August,
the same preflight with a different origin:

```
OPTIONS /membership   Origin: http://localhost:5178
  -> 204, access-control-allow-origin: http://localhost:5178
```

`http://localhost:5178` is the `SITE` value in `club/wrangler.toml` on the
`rehearsal` branch and nowhere else in this repository. So the code answering at
club.resonate.select is the build deployed from that branch during section 5,
and it has been serving the rehearsal ever since. It also explains the missing
headers without a second theory: `rehearsal` sits twenty-six commits behind this
one and predates the letterbox entirely.

That branch holds nothing worth keeping. Its seven commits are the rehearsal
scaffolding: `whyNotStripe`, which says in its own first line that it is never
merged, the `say('hook.unverified', ...)` beside it, and the localhost `SITE`.
Deleting it is safe and changes nothing about what is deployed. Only a deploy
does.

So the order is: deploy the worker from `main` after this merges, or from this
branch before it, then re-run the preflight above and see
`access-control-allow-origin: https://resonate.select` and `x-cap` in the
header list. Merging the site while the old worker is up ships a club nothing
can call.

`/` answering 401 rather than 404 is not a defect: every path requires a key.

The `10.x` line for `club.resonate.select` is still in `/etc/hosts` on the
development machine, now pointing at the same Cloudflare address DNS returns,
so it hides nothing today and should still go:

```bash
sudo sed -i '' '/club\.resonate\.select/d' /etc/hosts
```

### What the first push found, which three engines on this machine did not

The switch commit went green locally in all three engines and red on CI: two
letter tests, `firefox` and `webkit`, waiting thirty seconds for a letter that
had reached the club and never reached the screen. The letter was in the box on
both sides of the assertion, so nothing was wrong with the sealing or the
carrying.

Opening the letters room did not ask the club what was waiting. The verb behind
both roads in, the word on the index board and the command line, painted the
surface and stopped there; `showLetters`, which does ask, was reached only from
the toast and from an introduction. So the box was asked at three moments and
not the fourth, and the room a person walks into showed whatever the last look
had found.

The tests passed here because the boot look four seconds in landed *after* the
send on this machine, and on a slower runner it landed before. `club/SPEC.md`
§11a has said "and whenever the room is opened" since the day it was written:
the specification was right, the code was not, and the suite could not tell
because it waited for the letter rather than counting the asking. The mock now
tallies looks per box, and a test brackets each road in and requires exactly one.

Worth keeping as the shape of this class of defect: **a test that waits for an
outcome cannot distinguish the cause it names from a timer that happened to
fire.** rf119 is the version marker for the correction.

### The fast way to close it again

```bash
npx wrangler secret delete STRIPE_SECRET
```

That makes the worker's readiness check false, so `/checkout` and `/door` answer
503 in the club's own words within seconds, without waiting on a site rebuild.
Existing members keep reading, writing and deleting their vaults.

**`/portal` is guarded on the same secret and answers 503 too**, so while this
is in force nobody can leave from the club room, and Stripe goes on charging
anyone who does not write in. `TERMS.md` says a membership can be ended by
writing to us, and this is the state in which that sentence has to be honoured
by hand, in the Stripe Dashboard, the same day. It is a lever to pull for hours
rather than weeks. Reverting the switch commit is the slow rollback; this is
the fast one.

---

## Before anyone outside the beta pays

Everything on this list is now written and reachable from the site, in
`TERMS.md` and `PRIVACY.md`, except the three lines named in section 8: the
seller's identity and the bucket's location. Kept here as the check to run
against the published pages rather than against this file, because the list is
what a buyer is owed and the documents are only where it currently lives.

- merchant identity and a support address
- the exact price, currency, interval and tax treatment, and that it renews
- terms: what is sold, what is not, and on what law
- the privacy notice, and the subprocessors by name, Cloudflare and Stripe,
  and where the R2 bucket was placed
- the cancellation and refund policy, including the unused part of a paid year
  and the statutory withdrawal right that survives it
- what happens if the recovery phrase is lost
- what happens if the club closes, on the data and on the money
- how long a lapsed member's envelopes are kept
- the procedure for someone who paid and did not get a key
- the procedure for someone who lost the key and wants the backup deleted

**The price is already published, and the sentence that used to sit here said
it was not.** `test/docs.test.mjs` keeps `CHF` out of `index.html` and
`js/app.js` while `CLUB_URL` is empty, and out of nothing else. `TERMS.md`
carries `CHF 48 a year` with the interval and the tax treatment, the deploy
serves that file at its own address, and the smoke job requires it to be there
byte for byte. So from the moment the documents ship, a shut door and a
published price exist together: the app names no sum, and a document behind the
word names one.

That is defensible and it is not accidental, because the document has to state
what a membership costs to be a terms document at all, and it is marked
unfinished for exactly this reason. But it is a decision rather than a
guarantee, and the only thing enforcing it is that nobody links to the file.
Check it against the published page like every other item on this list. If it
should not be true, the fix is not another test: it is not publishing
`TERMS.md` and `PRIVACY.md` until the switch, which costs the ability to have
them read before they are relied on.

---

## The review sentence, and what it left behind (rf120)

Two surfaces used to say that nobody outside this project had reviewed the code:
the club room, under the sandbox note, and the how page, at the end of the
letters section. Both said it beside the true and narrower claim that the
sealing follows a published standard and matches that standard's own test
numbers. On 17 August 2026 the owner took the sentence out of both. The narrow
claim stays; the app now says nothing about who has read the code.

**Four documents still say it, and they were not touched:** `TERMS.md:37` and
`TERMS.md:298`, `SECURITY.md:154`, `THREATS.md:291`. So the state after this
release is an app that is quiet and a set of documents that are not, and a
person who reads the terms will find a limitation the room they bought it in no
longer mentions. That is a decision to make once rather than a thing to
discover: either the review has happened, in which case those four lines are
false and have to go, or it has not, in which case the two surfaces were the
only place a buyer met the limitation before paying.

`test/docs.test.mjs` used to pin the sentence in the club room and in `TERMS.md`.
It now pins `TERMS.md` and binds the pair that cannot both be true: neither the
club room nor the how page may claim a review while the documents say none has
happened. A denial is still legal on any surface, because a test that goes red
about an honest sentence teaches somebody to delete an honest sentence. All
three arms were proved by planting: the claim into the room, the claim into the
page, and the sentence out of `TERMS.md`.
