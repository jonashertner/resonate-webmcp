# The zone before it moved

Recorded 2026-08-16, from `dig` against the authoritative servers, following
step 1 of `LAUNCH.md` §2. It exists so that a rollback is a document rather
than a memory, and so that the reconciliation in step 3 of that section is a
comparison rather than a recollection.

This is what the answers were. It is not proof that nothing else exists: `dig`
answers the questions it is asked and cannot enumerate a zone. Export the zone
file from GoDaddy as well if the option is there.

## Where it was

```
resonate.select.  3600  IN  NS  ns33.domaincontrol.com.
resonate.select.  3600  IN  NS  ns34.domaincontrol.com.
resonate.select.  3600  IN  SOA ns33.domaincontrol.com. dns.jomax.net.
                                2026080602 28800 7200 604800 600
```

GoDaddy, and the apex on GitHub Pages.

## Every record that answered

```
resonate.select.       600   IN  A      185.199.108.153
resonate.select.       600   IN  A      185.199.109.153
resonate.select.       600   IN  A      185.199.110.153
resonate.select.       600   IN  A      185.199.111.153
www.resonate.select.   3600  IN  CNAME  jonashertner.github.io.
_dmarc.resonate.select. 3600 IN  TXT    "v=DMARC1; p=quarantine; adkim=r;
                                         aspf=r;
                                         rua=mailto:dmarc_rua@onsecureserver.net;"
_domainconnect.resonate.select. 3600 IN CNAME _domainconnect.gd.domaincontrol.com.
```

**Seven records, and the seventh is here because the warning above came true.**
`_domainconnect` was missing from the first version of this file, for the exact
reason that version gave: `dig` answers the questions it is asked and cannot
enumerate a zone, and nobody thinks to ask for a name they have never heard of.
Cloudflare's quick scan found it on 2026-08-16, and `dig` then confirmed it at
`ns33` once there was a name to ask about. It is GoDaddy's own record, pointing
at GoDaddy's own endpoint, and it is what lets a third party reconfigure this
zone at GoDaddy without a password. It should not travel: after the move it
names a provisioning authority for a zone that provider no longer serves. It is
recorded here because a rollback has to be able to put back what was there, not
what should have been there.

## Every record that did not

`AAAA`, `MX`, `TXT` at the apex, `CAA`, `DNSKEY`: all empty.

**That absence is most of the risk gone**, and it is worth naming rather than
noticing. No `MX` means no mail to break, which is the usual way a zone move
costs somebody a day. No `DNSKEY` means DNSSEC is off, so there is no signed
delegation to unwind before the nameservers change, which is the usual way a
zone move costs somebody a domain. Confirm both again on the day: a query
never made cannot fail, which is why they are in the list above with nothing
beside them.

## What this means for the move

- **Recreate exactly six of the seven at Cloudflare**, all **DNS-only** (grey
  cloud), and leave `_domainconnect` behind. Proxying the GitHub Pages apex
  puts Cloudflare in front of a host that is already serving the certificate,
  and the documented failure of that shape is two parties terminating TLS for
  one hostname.
- **Delete anything the scan adds that is not on the list above.** On
  2026-08-16 Cloudflare's quick scan imported a second `_dmarc` TXT reading
  `"v=DMARC1"`, which does not exist in this zone at all. Two records at
  `_dmarc` is not a stricter policy, it is no policy: RFC 7489 says that if the
  set contains multiple records, *policy discovery terminates and DMARC
  processing is not applied to this message*. The scan misses records and it
  also invents them, and the invented one was the more expensive.
- **The four apex addresses are GitHub's**, and they are the current published
  set. Check them against GitHub's own documentation on the day rather than
  copying them from here: this file records what was, not what is correct.
- **Lower the TTLs first.** The apex is already at 600. `www` and `_dmarc` are
  at 3600, so an hour of any mistake made in them, and lowering both to 600 a
  day ahead costs nothing.
- **`_dmarc` points at `onsecureserver.net`**, which is GoDaddy's. The record
  is a reporting address for mail that does not exist, so it survives the move
  unchanged; it is listed here because a TXT record nobody remembers is exactly
  the one a quick scan drops.

## What Cloudflare was proved to answer, before it was asked to

The zone was queried on its assigned nameservers, `maciej.ns.cloudflare.com`
and `tori.ns.cloudflare.com`, while GoDaddy was still authoritative and nothing
was delegated. Both agreed:

```
resonate.select.      A      185.199.108.153 .109.153 .110.153 .111.153
www.resonate.select.  CNAME  jonashertner.github.io.
_dmarc.resonate.select. TXT  one record, the full one
AAAA, MX, CAA, apex TXT, _domainconnect, club   all empty
```

It took two passes. The first returned `188.114.96.12` and `188.114.97.12` for
the apex, which are Cloudflare's own, and no CNAME at all for `www`: five
records were still proxied after being set, checked and reported as grey. That
is the whole reason this section exists. An orange cloud costs nothing until
the delegation moves, and then it costs everything at once, so the question has
to be put to the nameservers rather than to the table.

## What it answered after the delegation moved

The nameservers were changed at GoDaddy on 2026-08-16. Reconciled the same
evening, against `maciej.ns.cloudflare.com` and `tori.ns.cloudflare.com`
directly, because a resolver answers from a cache and an authority answers from
the zone. Both agreed, and both agree with the list above:

```
resonate.select.      A      185.199.108.153 .109.153 .110.153 .111.153
www.resonate.select.  CNAME  jonashertner.github.io.   and no address
_dmarc.resonate.select. TXT  v=DMARC1; p=quarantine; adkim=r; aspf=r;
                             rua=mailto:dmarc_rua@onsecureserver.net;
AAAA, MX, CAA, apex TXT, DNSKEY, _domainconnect, club    all empty
```

Six of the seven, and the seventh left behind on purpose. The `_dmarc` TXT that
Cloudflare's scan invented never travelled. `www` answers a CNAME and no
address, which is the grey cloud proved rather than reported. `DNSKEY` is
empty, so DNSSEC is still off and there is nothing signed to unwind. `club` is
empty because section 3 has not started.

The SOA is now `maciej.ns.cloudflare.com. dns.cloudflare.com.`, so the GoDaddy
serial in the delegation above is a rollback marker and no longer an answer
anyone receives.

**What proved it, and what could not.** The `.select` registry held the
Cloudflare pair within minutes; every public resolver followed, and this
machine's own resolver was the last, an hour behind the rest. The check that
mattered was the one put to the registry, because it has no cache to answer
from. The checks put to a resolver said `ns33`/`ns34` long after the move had
landed, and the checks put to the site said `185.199.x` and `HTTP/2 200` both
before and after, since that is exactly what a move nobody notices looks like.
`LAUNCH.md` §2 step 9 was rewritten the same evening for that reason.

## Rolling back

Set the nameservers at the registrar back to `ns33.domaincontrol.com` and
`ns34.domaincontrol.com`. GoDaddy keeps the zone it was serving, so this is a
revert and not a rebuild, and the SOA serial above (`2026080602`) is how you
tell whether what came back is what left.
