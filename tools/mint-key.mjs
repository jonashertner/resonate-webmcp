// mint-key.mjs — recompute a membership key, and prove the secret it came from.
//
// Two documents call the derivation "the recovery procedure, in one line", and
// there was no line: mintKeyFor lived inside the worker and its tests, so the
// procedure meant retyping an HMAC into an ad-hoc shell with the mint secret
// pasted beside it, in the hour a member has paid and cannot open their vault.
//
// Both answers come from club/src/validate.js rather than being restated here.
// A second implementation of either would be a second answer, and the whole
// point of deriving a key from the subscription id is that there is only ever
// one. That is also why fingerprintOf now lives in validate.js beside
// mintKeyFor: this tool and the worker have to agree about the fingerprint or
// the comparison below proves nothing.
//
//   the key for a subscription:
//     MINT_SECRET=... node tools/mint-key.mjs sub_1234
//     printf '%s' "$SECRET" | node tools/mint-key.mjs - sub_1234
//
//   the fingerprint the worker wrote into KV on its first mint:
//     MINT_SECRET=... node tools/mint-key.mjs --fingerprint
//     printf '%s' "$SECRET" | node tools/mint-key.mjs - --fingerprint
//
// The fingerprint is what makes the mint secret's one irreversible mistake
// visible. `wrangler secret put` echoes nothing back, so a secret set from a
// mistyped value looks exactly like a secret set correctly until the first
// member cannot reach their vault, by which time it cannot be changed. Compare
// this against the stored value before anybody pays:
//
//   npx wrangler kv key get mint:fp --remote --namespace-id=$NS
//
// Neither mode ever writes anything or talks to a network.

import { mintKeyFor, fingerprintOf } from '../club/src/validate.js';

const args = process.argv.slice(2);
const wantFingerprint = args.includes('--fingerprint');
const fromStdin = args.includes('-');
const subId = args.find(a => !a.startsWith('-'));

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

// stdin is read only when `-` asks for it. Reading it whenever it is not a
// terminal was worse in both directions: over ssh without a tty the tool hung
// for a secret nobody was sending, and an empty pipe fell through to whatever
// MINT_SECRET happened to hold, minting a well-formed key from the wrong
// secret with nothing to tell it apart from a right one.
async function readSecret() {
  if (!fromStdin) {
    return process.env.MINT_SECRET || '';
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  // one trailing newline is stripped, so `echo` and `printf` agree. nothing
  // else is touched: a trailing space is part of a secret and stays one.
  const piped = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (!piped) {
    die('nothing arrived on stdin. send the secret, or drop the - and set MINT_SECRET.\n' +
        'this refusal exists because an empty pipe used to fall back to the\n' +
        'environment and mint a real-looking key from the wrong secret.');
  }
  return piped;
}

const secret = await readSecret();
if (!secret) {
  die('no mint secret. set MINT_SECRET, or pass - and send it on stdin.\n' +
      'this is the value written down before `wrangler secret put MINT_SECRET`,\n' +
      'and it cannot be read back out of the worker.');
}

if (wantFingerprint) {
  process.stdout.write(await fingerprintOf(secret) + '\n');
  process.exit(0);
}

if (!subId) {
  die('give a subscription id, or --fingerprint.\n' +
      'the id is on the subscription in Stripe, and it is the only thing\n' +
      'besides the mint secret that the key depends on.');
}
if (!/^sub_[A-Za-z0-9]+$/.test(subId)) {
  // The shape is checked because a checkout session id, a customer id, or a
  // subscription *schedule* id would each mint a real-looking key for a vault
  // that is not the member's. sub_sched_ is deliberately refused rather than
  // admitted by loosening this: it names a different object.
  die(`"${subId}" is not the shape of a subscription id.\n` +
      'it is sub_ followed by letters and digits only: not cs_, not cus_, and\n' +
      'not sub_sched_, which is a subscription schedule and a different object.');
}

process.stdout.write(await mintKeyFor(subId, secret) + '\n');
