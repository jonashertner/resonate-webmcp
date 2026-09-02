#!/usr/bin/env bash
#
# proof.sh: the checks of LAUNCH.md §1b, run rather than transcribed.
#
# The curl blocks in the runbook stay there, and this changes nothing about
# them: same endpoints, same parameters, same API version. What it removes is
# the transcription. A proof retyped by hand at the end of a long afternoon is
# a proof that passes because a flag got dropped, and the flags are the point.
#
# It never takes the key as an argument. An argument is in the shell history
# and in the process list, which is two more copies than a secret should have.
# It asks instead, and nothing echoes.
#
#   ./proof.sh walk           # all three, in the order they depend on
#   ./proof.sh portal cus_... # the fourth, which needs a Customer made by hand
#   ./proof.sh taxfix         # the one repair: tax_behavior, once, on purpose
#
# or one at a time, which is the same thing spelled out:
#
#   ./proof.sh price          # 1. the Price is the one you meant to make
#   ./proof.sh open           # 2. a session, with every flag the worker sends
#   ./proof.sh read cs_...    # 3. after paying, what the door will see
#
# If SK and PRICE are already in the environment it uses those and asks
# nothing, which is what makes it usable twice in one sitting.
#
# Nothing here writes to disk and nothing here prints the key.

set -euo pipefail

API_VERSION='2025-03-31.basil'   # what club/src/stripe.js pins. Not the newest,
                                 # deliberately: see LAUNCH.md §1b.

die() { printf '\nFAIL  %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS  %s\n' "$*"; }
note() { printf '      %s\n' "$*"; }

# Ask for the key rather than requiring it to have been exported.
#
# The earlier version told the reader to run `read -rs SK && export SK` first,
# and that instruction failed in every way an instruction can: it printed no
# prompt, so the terminal looked hung; it echoed nothing, so a paste looked
# like nothing; and `SK` reads as a placeholder, so it got replaced with the
# key itself, which put the key in the shell history. Three failure modes for
# a step that only existed to keep the key out of the history.
#
# So the script asks. Nothing echoes, nothing is stored, and the value lives
# only for as long as this one command runs. It reads the ordinary standard
# input rather than reaching for /dev/tty, which costs nothing in a terminal
# and is the difference between a prompt that can be tested and one that can
# only be tried.
ask_key() {
  printf 'Stripe restricted key (rk_test_...). Paste it; it will not appear.\n' >&2
  printf '> ' >&2
  IFS= read -rs SK || true
  printf '\n' >&2
  SK="${SK//[[:space:]]/}"      # a paste often brings a newline or a space
  export SK
}

ask_price() {
  printf 'The Price id from step 1 (price_...): ' >&2
  IFS= read -r PRICE || true
  PRICE="${PRICE//[[:space:]]/}"
  export PRICE
}

# The key this proof is for, and the three it refuses.
#
# A secret key would pass every check below and prove nothing, because the
# whole question is whether a RESTRICTED key carries the three permissions the
# worker needs. And a live key has no business in a sandbox rehearsal at all:
# step 1 is a rehearsal, and the first thing a rehearsal must not do is charge
# somebody. All three refusals are here because all three are one paste away,
# and one of them has already happened.
guard_key() {
  [ -n "${SK:-}" ] || ask_key
  [ -n "${SK:-}" ] || die 'no key was given.'
  case "$SK" in
    rk_test_*) ;;
    rk_live_*) die 'SK is a LIVE restricted key. §1b is a sandbox rehearsal.' ;;
    sk_live_*) die 'SK is a LIVE secret key. Roll it, then make a sandbox rk_test_.' ;;
    sk_test_*) die 'SK is a full-access test key, not the restricted key §1 asks
      for. It would pass these checks while proving nothing about the three
      permissions the worker actually needs.' ;;
    *) die 'SK does not look like a Stripe key.' ;;
  esac
}

api() {   # api <method> <path> [curl args...]
  local method="$1" path="$2"; shift 2
  curl -sS -X "$method" "https://api.stripe.com/v1${path}" \
    -u "$SK:" -H "Stripe-Version: ${API_VERSION}" "$@"
}

# Stripe answers an error with 200-shaped JSON carrying an `error` object as
# often as not, so the status is not the check. The message is.
check_error() {
  python3 -c '
import sys, json
try:
    body = json.load(sys.stdin)
except Exception as e:
    raise SystemExit("Stripe did not answer JSON: %s" % e)
err = body.get("error")
if err:
    raise SystemExit("Stripe refused it: [%s/%s] %s" % (
        err.get("type"), err.get("code"), err.get("message")))
json.dump(body, sys.stdout)
'
}

cmd_price() {
  guard_key
  [ -n "${PRICE:-}" ] || ask_price
  [ -n "${PRICE:-}" ] || die 'no Price id was given.'
  # Reading a Price needs a permission the worker itself never needs: it hands
  # Stripe a price id and reads the price back off the expanded subscription,
  # so Prices read is not among the three resources §1 asks for. A key scoped
  # exactly as §1 says may therefore be refused here, and that refusal is the
  # key being right rather than wrong. It must not read as a failure.
  api GET "/prices/${PRICE}" | python3 -c '
import sys, json
p = json.load(sys.stdin)
err = p.get("error")
if err:
    msg = str(err.get("message") or "")
    if err.get("code") == "api_key_insufficient_scope" or "permission" in msg.lower():
        print("      Prices read is not on this key, and does not need to be:")
        print("      the worker never reads a Price directly. Check the four")
        print("      fields by eye in the Dashboard instead, then run `open`.")
        print("      NOT CHECKED, which is not the same as checked and fine.")
        raise SystemExit(0)
    raise SystemExit("Stripe refused it: [%s/%s] %s" % (
        err.get("type"), err.get("code"), msg))
r = p.get("recurring") or {}
tb = p.get("tax_behavior")

# What each mismatch costs, which is the whole value of reading this early.
# Amount, currency and interval are gone the moment the Price exists. Tax
# behaviour is the one exception in the API: it may move exactly once, out of
# "unspecified" and never again, so an unspecified Price is repairable and an
# exclusive one is not. `active` is how archiving works, so it is always
# repairable. `livemode` is not a property of the Price at all: it says which
# store answered, so a surprise there is a wrong key, not a wrong Price.
rows = [
    ("amount",         p.get("unit_amount"),    4800,        "gone"),
    ("currency",       p.get("currency"),       "chf",       "gone"),
    ("interval",       r.get("interval"),       "year",      "gone"),
    ("interval_count", r.get("interval_count"), 1,           "gone"),
    ("tax_behavior",   tb, "inclusive", "once" if tb == "unspecified" else "gone"),
    ("active",         p.get("active"),         True,        "repairable"),
    ("livemode",       p.get("livemode"),       False,       "store"),
]
for k, got, exp, _ in rows:
    print("      %-14s %-12s %s" % (k, got, "" if got == exp else "WANTED %s" % exp))

bad = [(k, kind) for k, got, exp, kind in rows if got != exp]
if bad:
    gone = [k for k, kind in bad if kind == "gone"]
    once = [k for k, kind in bad if kind == "once"]
    store = [k for k, kind in bad if kind == "store"]
    repairable = [k for k, kind in bad if kind == "repairable"]
    lines = []
    if repairable:
        lines.append("This Price is archived. Reactivate it in the Dashboard, "
                     "or POST active=true. Nothing about it is lost.")
    if store:
        lines.append("This Price is in the LIVE store, so the key that read it "
                     "is a live key or the Price was made outside the sandbox.")
    if gone:
        lines.append("Cannot be changed on a Price that exists: %s." % ", ".join(gone))
        # Deletion is Dashboard-only and conditional. The API has no delete
        # endpoint for a Price at all, so archiving is the only thing that can
        # be scripted, and a Price nobody has bought can simply go.
        lines.append("Create another. This one can be DELETED in the Dashboard "
                     "if it has never been used, and archived if it has.")
    if once and not gone:
        lines.append("tax_behavior is still \"unspecified\", which may be set "
                     "ONCE, to inclusive, and never again. No need to recreate "
                     "the Price: see LAUNCH.md §1.")
    elif once:
        lines.append("Set tax_behavior on the new one at creation.")
    raise SystemExit("\n      ".join(lines))
'
  pass "the Price is CHF 48 a year, inclusive, active, and not live"
}

cmd_open() {
  guard_key
  [ -n "${PRICE:-}" ] || ask_price
  [ -n "${PRICE:-}" ] || die 'no Price id was given.'
  local claim; claim="$(openssl rand -hex 32)"
  note "claim commitment ${claim}"

  # Every parameter here is one club/src/worker.js sends. A shorter proof
  # passes on account states under which the club's own request is refused.
  api POST /checkout/sessions \
    -H "Idempotency-Key: launch-proof-${claim}" \
    -d mode=subscription \
    -d "line_items[0][price]=${PRICE}" \
    -d "line_items[0][quantity]=1" \
    -d "payment_method_types[0]=card" \
    -d "adaptive_pricing[enabled]=false" \
    -d allow_promotion_codes=false \
    -d billing_address_collection=auto \
    -d "metadata[claim]=${claim}" \
    -d "subscription_data[metadata][claim]=${claim}" \
    -d success_url=https://resonate.select/ \
    -d cancel_url=https://resonate.select/ \
    | check_error | python3 -c '
import sys, json
s = json.load(sys.stdin)
ap = s.get("adaptive_pricing")
# Stripe documents what enabled=true does and says the field otherwise follows
# the Dashboard. It documents nothing about false, and nothing about whether a
# session-level false beats an account-level on. So it is read back, not
# assumed: this is the club one-currency promise, and it fails silently.
if (ap or {}).get("enabled"):
    raise SystemExit("ADAPTIVE PRICING IS ON for this session: %r. The page "
                     "says CHF 48 and the buyer is charged in their own "
                     "currency at Stripe rate." % (ap,))
# Absent is not off. A check that treats a field which never arrived as a pass
# is the same fail-open this whole file exists to refuse, so it is named: the
# run continues, because an account may legitimately not report it, but it
# stops claiming to have proved anything.
if ap is None:
    print("      adaptive_pricing NOT REPORTED, so the belt is NOT proved.")
    print("                       The field did not come back at all. Check")
    print("                       the Dashboard toggle by hand before live.")
else:
    print("      adaptive_pricing %s, and the belt held" % (ap,))
print("      currency         %s" % s.get("currency"))
print("      session          %s" % s.get("id"))
print()
print("      pay it with 4242 4242 4242 4242, then: ./proof.sh read %s"
      % s.get("id"))
print()
print(s.get("url"))
'
  pass "the session was created with every flag the worker sends"
}

cmd_read() {
  guard_key
  local session="${1:-}"
  [ -n "$session" ] || die 'which session? ./proof.sh read cs_...'
  api GET "/checkout/sessions/${session}?expand[]=subscription" \
    | check_error | python3 -c '
import sys, json
s = json.load(sys.stdin)
sub = s.get("subscription")
if sub is None:
    raise SystemExit("no subscription on this session yet. Pay it first.")
# A restricted key without Subscriptions read does not get an error here. It
# gets the object quietly replaced by its id, which a happy path never
# notices. That fail-open is the reason this check is spelled out.
if isinstance(sub, str):
    raise SystemExit("SUBSCRIPTIONS READ IS MISSING: the subscription came "
                     "back as a bare id, not an object. Add the permission "
                     "and make a new key.")
item = sub["items"]["data"][0]
price = item["price"]
print("      payment_status   %s" % s.get("payment_status"))
print("      status           %s" % s.get("status"))
print("      livemode         %s" % s.get("livemode"))
print("      price            %s" % price.get("id"))
print("      currency         %s" % price.get("currency"))
print("      recurring        %s" % price.get("recurring"))
print("      quantity         %s" % item.get("quantity"))
print("      claim            %s" % (s.get("metadata") or {}).get("claim"))
if s.get("livemode"):
    raise SystemExit("this is a LIVE session. §1b is a sandbox rehearsal.")
if (s.get("metadata") or {}).get("claim") is None:
    raise SystemExit("the claim commitment did not survive into metadata, "
                     "which is the field the door reads.")
'
  pass "Checkout Sessions and Subscriptions are both proved"
}

cmd_portal() {
  guard_key
  local customer="${1:-}"
  [ -n "$customer" ] || die 'which customer? Make a throwaway one in the
      Dashboard (a restricted key cannot), then: ./proof.sh portal cus_...'
  # The third permission, and the one nothing else here touches. Stripe
  # describes Customer Portal write as covering portal settings, not sessions;
  # that it also covers this call follows only from POST mapping to write. An
  # inference is not an answer, so it gets asked.
  api POST /billing_portal/sessions \
    -d "customer=${customer}" \
    -d return_url=https://resonate.select/ \
    | check_error | python3 -c '
import sys, json
s = json.load(sys.stdin)
if not s.get("url"):
    raise SystemExit("no url came back: %s" % json.dumps(s)[:400])
print("      %s" % s["url"])
'
  pass "Customer portal write is proved. Delete the throwaway customer."
}

# The three checks in the order they depend on each other, so that the whole of
# §1b is one command and a card number. The Price is verified before a session
# is built on it, because the Price is the part that cannot be edited.
#
# The portal check stays separate: it needs a throwaway Customer created by
# hand in the Dashboard, which a restricted key deliberately cannot do.
cmd_walk() {
  cmd_price
  echo
  local out id
  out="$(cmd_open)"
  printf '%s\n' "$out"
  id="$(printf '%s' "$out" | sed -n 's/.*session *\(cs_[A-Za-z0-9_]*\).*/\1/p' | head -1)"
  [ -n "$id" ] || die 'no session id came back to read.'
  echo
  printf 'Pay the url above with 4242 4242 4242 4242, then press return. '
  read -r _ || true
  echo
  cmd_read "$id"
  echo
  note 'Then, with a throwaway Customer made in the Dashboard:'
  note '  ./club/proof.sh portal cus_...'
}

# The one thing here that changes something, and why it is here at all.
#
# Everything else in this file reads. This writes, once, and can never be
# undone: tax_behavior may move out of "unspecified" a single time and is
# locked from then on. It earns its place because the alternative is a curl
# typed by hand carrying `-u "$SK:"`, which puts the key on a command line, in
# the shell history and in the process list. A repair that leaks the key is a
# worse repair.
#
# So it is deliberate rather than convenient: it refuses unless the Price is
# exactly "unspecified", it says what it is about to do, it asks for the word
# to be typed rather than a key to be pressed, and it reads the Price back
# afterwards rather than trusting its own request.
cmd_taxfix() {
  guard_key
  [ -n "${PRICE:-}" ] || ask_price
  [ -n "${PRICE:-}" ] || die 'no Price id was given.'

  local now
  now="$(api GET "/prices/${PRICE}" | check_error | python3 -c \
    'import sys,json; print(json.load(sys.stdin).get("tax_behavior"))')"
  case "$now" in
    inclusive)   pass "tax_behavior is already inclusive. Nothing to do."; return 0 ;;
    unspecified) ;;
    *) die "tax_behavior is \"${now}\", not \"unspecified\". Once it is
      inclusive or exclusive it can never be changed again, so this Price
      cannot be repaired. Create another and set it at creation." ;;
  esac

  note "Price      ${PRICE}"
  note 'change     tax_behavior: unspecified -> inclusive'
  note 'permanent  it can never be changed again, in either direction'
  printf 'Type the word inclusive to do it, anything else to stop: ' >&2
  local reply=''; IFS= read -r reply || true
  [ "$reply" = 'inclusive' ] || die 'stopped, and nothing was changed.'

  api POST "/prices/${PRICE}" -d tax_behavior=inclusive | check_error >/dev/null

  # read it back rather than believing the response we just sent
  local after
  after="$(api GET "/prices/${PRICE}" | check_error | python3 -c \
    'import sys,json; print(json.load(sys.stdin).get("tax_behavior"))')"
  [ "$after" = 'inclusive' ] || die "Stripe reports tax_behavior as \"${after}\"."
  pass 'tax_behavior is inclusive. Run `./club/proof.sh walk` again.'
}

case "${1:-}" in
  walk)   cmd_walk ;;
  taxfix) cmd_taxfix ;;
  price)  cmd_price ;;
  open)   cmd_open ;;
  read)   cmd_read "${2:-}" ;;
  portal) cmd_portal "${2:-}" ;;
  *) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//' ; exit 1 ;;
esac
