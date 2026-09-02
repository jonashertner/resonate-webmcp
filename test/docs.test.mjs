// docs.test.mjs — the code and the documents must say the same thing.
//
// A privacy product whose security page contradicts its source is not making a
// cosmetic mistake. These assertions failed once, quietly, for two releases:
// the page said PBKDF2 while the envelope had moved to Argon2id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const club = read('js/club.js');
const worker = read('club/src/worker.js');
const spec = read('club/SPEC.md');
const security = read('SECURITY.md');
const readme = read('README.md');
const app = read('js/app.js');
const store = read('js/store.js');
const schema = read('js/schema.js');
const sw = read('sw.js');
const threats = read('THREATS.md');
const clubReadme = read('club/README.md');
const page = read('index.html');
const privacy = read('PRIVACY.md');
const terms = read('TERMS.md');
const assistant = read('ASSISTANT-ACCESS.md');

test('the envelope written by the code is the one the documents describe', () => {
  // what the code actually does
  assert.ok(/MAGIC2 = new TextEncoder\(\)\.encode\('rsnt2'\)/.test(club), 'rsnt2 is the written form');
  assert.ok(/ARGON2_M = 65_536/.test(club), 'argon2id at 64 MiB');
  assert.ok(/ROUNDS_WRITE = 600_000/.test(club), 'pbkdf2 fallback at 600000');

  for (const [name, doc] of [['SPEC', spec], ['SECURITY', security]]) {
    assert.ok(/[Aa]rgon2id/.test(doc), `${name} names argon2id`);
    assert.ok(/64 MiB|65536|65_536/.test(doc), `${name} names the memory cost`);
    assert.ok(/600000|600,000|600_000/.test(doc), `${name} names the pbkdf2 fallback count`);
    assert.ok(/rsnt2/.test(doc) || /second form/.test(doc), `${name} names the current envelope`);
  }
});

test('no document still calls pbkdf2 the current default', () => {
  for (const [name, doc] of [['SECURITY', security], ['SPEC', spec]]) {
    const sentences = doc.split(/(?<=\.)\s+/);
    const wrong = sentences.filter(x =>
      /PBKDF2/.test(x) && /(sealed on the device|is what seals|current default)/i.test(x)
      && !/fallback|older|before this|legacy/i.test(x));
    assert.deepEqual(wrong, [], `${name} still presents pbkdf2 as the default`);
  }
});

test('the door and the vault answer as the spec says they answer', () => {
  // The secret is minted under one label, kept in one place, and committed to
  // before a payment rather than after it. The spec is where a member's own
  // client would be written from, so it names the same three things.
  assert.ok(/tc-join:/.test(club), 'the device hashes its secret under its label');
  assert.ok(/tc-join:/.test(read('club/src/validate.js')), 'and the club hashes it under the same one');
  assert.ok(/tc-join:/.test(spec), 'and the spec names the label both sides use');
  assert.ok(/resonate\.club\.join\.v1/.test(club) && /resonate\.club\.join\.v1/.test(spec),
    'the secret is kept where the spec says it is kept');
  assert.ok(/metadata\[claim\]/.test(read('club/src/stripe.js')) && /metadata\[claim\]/.test(spec),
    'the commitment travels in the session metadata, and the spec says where it lives');
  assert.ok(/adaptive_pricing\[enabled\]', 'false'/.test(read('club/src/stripe.js'))
    && /adaptive_pricing\[enabled\]=false/.test(spec),
    'the session refuses adaptive pricing, and the spec says it does');

  // every refusal the wire can answer is written down as a refusal
  for (const code of ['403', '409', '412', '428', '429', '503']) {
    assert.ok(new RegExp(`\\b${code}\\b`).test(worker), `the worker answers ${code}`);
    assert.ok(new RegExp(`\\b${code}\\b`).test(spec), `and the spec names ${code}`);
  }
  assert.ok(/if-match/.test(worker) && /If-Match/.test(spec), 'the seal names what it replaces');
  assert.ok(/if-none-match/.test(worker) && /If-None-Match/.test(spec), 'and says when it replaces nothing');

  // this one is not documentation but survival: a browser sees neither the
  // etag nor the precondition unless the worker says so, and a vault whose
  // revision is invisible can be written exactly once
  //
  // Named one at a time rather than as one exact string. The list grew when the
  // letterbox arrived, and an assertion on the whole line fails on an addition
  // as loudly as on a deletion, which trains whoever is next to paste the new
  // line in without reading it. These fail only on a removal, which is the
  // thing that breaks a client.
  for (const name of ['x-sealed-at', 'x-arrived-at', 'etag']) {
    assert.ok(new RegExp(`'access-control-expose-headers': '[^']*\\b${name}\\b`).test(worker),
      `${name} reaches the client`);
  }
  for (const name of ['if-match', 'if-none-match', 'x-cap']) {
    assert.ok(new RegExp(`'access-control-allow-headers': '[^']*\\b${name}\\b`).test(worker),
      `${name} reaches the club`);
  }
});

test('the letterbox answers as the spec says it answers', async () => {
  // The spec is where somebody else's client would be written from, so a number
  // that moves in the code and not here is a client that will be refused for
  // reasons it was told nothing about. Read out of the modules rather than
  // typed here twice, so this cannot agree with a stale copy of itself.
  const box = read('club/src/letterbox.js');
  const letters = read('js/letters.js');
  const { BOX_LIMITS } = await import('../club/src/letterbox.js');
  const { KINDS } = await import('../js/letters.js');

  for (const [what, n] of Object.entries(BOX_LIMITS)) {
    assert.ok(new RegExp(`\\b${n}\\b`).test(spec), `the spec does not name ${what}, which is ${n}`);
  }
  for (const [name, n] of Object.entries(KINDS)) {
    assert.ok(new RegExp(`\\b${n} ${name}\\b`).test(spec), `the spec does not name kind ${n} as ${name}`);
  }

  // the wire, in the two places it has to be the same wire
  assert.ok(/rsntl/.test(spec) && /rsntl/.test(letters), 'the magic is not in both');
  const head = /const HEAD = [^;]+;\s*\/\/\s*(\d+)/.exec(letters);
  assert.ok(head, 'the header length is no longer written down beside itself');
  assert.ok(new RegExp(`first ${head[1]} bytes are the AAD`).test(spec),
    `the spec does not say the aad is ${head[1]} bytes`);

  // every refusal the wire can answer is written down as a refusal
  for (const code of ['400', '401', '402', '403', '404', '409', '413', '429', '503', '507']) {
    assert.ok(new RegExp(`\\b${code}\\b`).test(worker + box), `the club never answers ${code}`);
    assert.ok(new RegExp(`\\b${code}\\b`).test(spec), `and the spec does not name ${code}`);
  }

  // and the one promise that is a decision rather than a mechanism
  assert.ok(/Retention: until burned/.test(spec), 'the spec no longer states the retention');
  assert.ok(!/expirationTtl|setAlarm/.test(box), 'the letterbox grew an expiry the spec denies');
});

test('the readme does not promise a product the code no longer is', () => {
  assert.ok(!/five stars|five-star/i.test(readme), 'the rating is gone from the product');
  assert.ok(!/No account, no server, no build step/.test(readme),
    'the club is a server of ours, and the readme must qualify the claim');
  for (const format of ['GeoJSON', 'KML', 'CSV', 'Markdown', 'GPX']) {
    assert.ok(new RegExp(format, 'i').test(readme), `the readme names ${format}, which the app exports`);
  }
});

test('the shipped policy speaks only to addresses that exist', () => {
  const html = read('index.html');
  const csp = /content="([^"]*default-src[^"]*)"/.exec(html)?.[1] || '';
  assert.ok(csp, 'there is a policy at all');
  assert.ok(!/localhost/.test(csp), 'no development address ships to readers');
  assert.ok(/script-src 'self' 'wasm-unsafe-eval'/.test(csp), 'wasm is allowed for argon2id, and said so in THREATS');
  assert.ok(/font-src 'self'/.test(csp), 'the typefaces come from this site');

  // A pattern where an origin belongs. The policy named https://*.workers.dev
  // for a club that has never been deployed: a standing permission to reach
  // every worker anybody has ever put on that host, granted in advance of
  // a need, on a page that can read the whole atlas. Deployed javascript is
  // the one thing here with access to everything at once, so what it may talk
  // to is named one address at a time.
  const wild = /connect-src[^;]*\*\./.exec(csp);
  assert.equal(wild, null, `connect-src names a pattern instead of an origin: ${wild && wild[0]}`);
  assert.ok(!/workers\.dev/.test(csp),
    'the club door is shut, and the policy still let the page reach for it');
});

// The first promise stays short enough to understand before making a choice.
// Provider-by-provider detail is one named disclosure away on that same first
// screen, rather than mixed into the product's clearest statement of purpose.
test('the first promise a person reads is one the app can keep', () => {
  const html = read('index.html');
  const threshold = /<p class="th-quiet">([\s\S]*?)<\/p>/.exec(html)?.[1] || '';
  const disclosure = /<details class="th-detail th-privacy"[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1] || '';
  assert.ok(threshold, 'the threshold lost the paragraph that makes the promise');
  assert.ok(disclosure, 'the threshold lost its provider disclosure');

  assert.ok(!/nothing is sent anywhere/i.test(threshold),
    'a claim broader than the architecture: the page, the tiles and the searches are all requests');
  assert.ok(!/nobody but you can see it/i.test(threshold),
    'this says something about every party at once. it can only speak for us');

  // what it must say instead, in the directions that matter: who does not
  // receive the atlas, which supporting requests happen, and which acts remain
  // deliberate choices
  assert.match(threshold, /does not receive (?:your atlas|it) or have access to it/,
    'the claim has to be about us, because we are the only party we can speak for');
  assert.match(threshold, /It stays on this device unless you share it or use encrypted club backup/,
    'the two deliberate ways an atlas leaves are the two the sentence has to name');
  assert.match(disclosure, /CARTO/,
    'a person told the map talks to somebody is owed the name');
  assert.match(disclosure, /Photon/,
    'automatic typeahead reaches a provider too, and must not be hidden');
  assert.match(disclosure, /Nominatim/,
    'search and reverse geocoding reach a second one, which has a name of its own');
});

test('assistant documents name the zero-data review door and the exact exclusion boundary', () => {
  for (const [name, doc] of [['assistant contract', assistant], ['privacy', privacy], ['threat model', threats]]) {
    assert.match(doc, /zero-data/i, `${name} omits the pre-consent review tool`);
    assert.match(doc, /returns\s+no\s+atlas\s+data/i, `${name} does not bound the review tool to zero data`);
    assert.match(doc, /cannot grant access/i, `${name} lets the review tool sound like consent`);
    assert.match(doc, /five (?:same-origin |data )?tools/i, `${name} does not distinguish the post-consent tools`);
  }
  assert.match(assistant, /`review_assistant_access`/,
    'the data contract does not name the pre-consent tool');
  assert.match(assistant, /A place, path, or book marked \*\*Excluded from sharing\*\*/,
    'the data contract does not say excluded paths stay out');
  assert.match(assistant, /presses \*\*Add to my atlas\*\*/,
    'the data contract names an action the proposal no longer has');
});

test('the share target keeps what is shared off the wire', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.share_target.method, 'POST',
    'a GET share target puts the shared place in a request the host can see');
  assert.ok(/share-target/.test(read('sw.js')), 'and the worker intercepts it');
});

// Every place this app writes to is a place a person may need to find, empty,
// or rescue by hand. A key the readme does not name is a key nobody knows to
// look for, which is the whole problem with a quarantine nobody was told about.
test('the readme names every place this app keeps something', () => {
  for (const name of ['places', 'routes', 'folios', 'tags', 'correspondents', 'settings']) {
    assert.ok(new RegExp(`'resonate\\.${name}\\.v1'`).test(store), `store.js keeps ${name}`);
    assert.ok(new RegExp(`\\.${name}\\.v1`).test(readme), `and the readme names the ${name} key`);
  }

  // the quarantine: damaged bytes are set aside under a name, and refused
  assert.ok(/`\$\{key\}\.unreadable`/.test(store), 'store.js sets the damaged bytes aside');
  assert.ok(/\.unreadable/.test(readme), 'and the readme names the quarantine key');
  assert.ok(/\.unreadable/.test(security), 'and security says what it is for');

  // the share inbox is a second database, and an erase has to reach it
  assert.ok(/INBOX_DB = 'resonate-share'/.test(sw), 'the worker writes the inbox');
  assert.ok(/SHARE_DB = 'resonate-share'/.test(app), 'and the app reads the same one');
  assert.ok(/objectStore\('shared'\)\.clear\(\)/.test(app), 'and an erase empties it atomically');
  assert.ok(/resonate-share/.test(readme), 'and the readme names the inbox database');

  // the two remaining keys, which used to be nowhere in the documents
  assert.ok(/INBOX_KEY = 'resonate\.inbox\.v1'/.test(app) && /resonate\.inbox\.v1/.test(readme),
    'the readme names the share inbox key');
  assert.ok(/JOIN_STORE = 'resonate\.club\.join\.v1'/.test(club) && /resonate\.club\.join\.v1/.test(readme),
    'the readme names where the club join secrets are kept');

  // and the database beside them: the snapshots, and whatever photographs a
  // device was holding when this build stopped keeping them
  assert.ok(/const DB = 'resonate'/.test(read('js/photos.js')), 'the snapshots live in `resonate`');
  assert.ok(/IndexedDB\s+`resonate`/.test(readme), 'and the readme names that database');
});

// Import was one operation under a word that promised two. A document that
// still describes it as one is telling a person their backup can restore.
test('the readme describes both halves of import, not just the merge', () => {
  assert.ok(/bring\s+in\s+what\s+is\s+missing/i.test(app) && /make\s+this\s+atlas\s+the\s+file/i.test(app),
    'the app offers both words');
  assert.ok(/bring\s+in\s+what\s+is\s+missing/i.test(readme), 'and the readme names the merge');
  assert.ok(/make\s+this\s+atlas\s+the\s+file/i.test(readme), 'and the readme names the replace');
  assert.ok(/store\.restore\(/.test(app) && /restore\(raw\)/.test(store),
    'the replace is a restore, not a merge with extra steps');
  assert.ok(/snapshot/i.test(readme), 'and the readme says a snapshot is taken first');
});

// The club is add-only. Any document that lets a reader believe otherwise is
// promising that a deletion travels, and it does not.
// A backup that is only ever in one place is a backup with a limit, and the
// limit is the owner's decision rather than an oversight: replicating the
// envelopes would double what is held about a member and double what a breach
// or a court order could reach, to insure a failure the member answers better
// than we do by exporting a file.
//
// A decision like that survives exactly as long as it is written down where a
// person about to pay can read it. So it is bound here, on every surface that
// makes the promise, and it is bound to the absence of replication in the
// worker: the day the club copies an envelope somewhere else, this test says
// so and the sentences have to change with it.
test('the club says where its protection stops, everywhere it makes the promise', () => {
  const says = (text) => /losing (your|their) device/i.test(text)
    && /(not|never)[^.]*\b(our|one) (account|company)/i.test(text);

  // the count this test used to assert in passing now has a test of its own,
  // which derives it instead of repeating it
  assert.ok(says(threats), 'THREATS does not say the club protects a device and not an account');
  assert.match(threats, /not copied anywhere else/i,
    'the threat model does not say the envelopes are copied nowhere else');
  assert.ok(says(clubReadme), 'the club README does not say where its protection stops');
  assert.match(page, /protect against losing a device, not the service itself/i,
    'the short guide promises a backup without naming the limit');
  // Twice in app.js, because the club has two rooms and they are one file: the
  // shut door a person reads before deciding, and the member panel they read
  // after paying. A single match would let either of them lose the sentence
  // while the other kept the test green.
  const inApp = app.split(/(?<=\.)\s+/).filter(says).length;
  assert.ok(inApp >= 2,
    `the club says where its protection stops on ${inApp} of its two surfaces`);

  // and the reader is pointed at the answer that is actually in their hands
  for (const [name, doc] of [['THREATS', threats], ['the short guide', page], ['the club room', app]]) {
    assert.ok(/download|export/i.test(doc), `${name} names the limit without naming the remedy`);
  }

  // bound to the code: nothing replicates today, and if that changes the
  // sentences above are wrong rather than merely out of date
  assert.equal(/replicat/i.test(worker), false,
    'the worker replicates now, and three documents still say it does not');
});

// The count is written in words, in three places, by three different hands: a
// line of prose at the top of THREATS, a sentence on the how page pointing a
// reader at it, and the headings themselves. The test above pins two of them
// to the literal seventeen, which is the wrong shape: it goes green on a
// document that has grown an eighteenth question and forgotten to say so, and
// it has to be edited by the same person, in the same sitting, as the mistake
// it exists to catch.
//
// This reads the headings and derives the word, so the number is asserted by
// counting rather than by repetition. It matters more than a tidy-up because
// the launch adds questions: the closure policy and the retention answer are
// both candidates, and the surface that would keep the old word is the one
// sentence a person reads before deciding whether any of it is true.
test('the threat model counts its own questions, and the page agrees', () => {
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
    'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

  const numbers = [...threats.matchAll(/^## (\d+)\./gm)].map(m => Number(m[1]));
  assert.ok(numbers.length > 0, 'the threat model has no numbered questions at all');

  // an unbroken run from one, so a duplicated or skipped heading is a miscount
  // and not a silently shorter list
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1),
    `the questions are numbered ${numbers.join(', ')}`);

  // a ratchet, and the reason the literal that used to live in the test above
  // is not simply gone. Deriving the count from the headings catches a question
  // added without a word changed, but it goes green just as happily on a
  // question deleted and the word lowered to match, which is a promise
  // withdrawn in a passing suite. The list only grows.
  const n = numbers.length;
  assert.ok(n >= 17,
    `the threat model answered seventeen questions and now answers ${n}`);

  const word = WORDS[n];
  assert.ok(word, `there are ${n} questions and this test cannot spell that`);

  const prose = new RegExp(`\\b${word} questions\\b`, 'i');
  assert.match(threats, prose,
    `the threat model answers ${n} questions and its own first line does not say ${word}`);

  assert.match(page, /href="read\.html\?d=threats"/,
    'the short guide no longer links to the threat model');
});

test('no document sells the club as synchronisation', () => {
  // what the code does: an envelope comes home through the additive merge
  assert.ok(/bringHome\(atlas\)/.test(app), 'an envelope comes home through bringHome');
  assert.ok(/const added = store\.merge\([^;]*\{ own: true \}\)/.test(app),
    'and bringHome without replace is a merge, which only adds');

  for (const [name, doc] of [['README', readme], ['SECURITY', security]]) {
    const sentences = doc.split(/(?<=\.)\s+/);
    const wrong = sentences.filter(x =>
      /synchronis|synchroniz|\bsync\b|\bsyncs\b/i.test(x)
      && !/\bnot\b|\bno\b|\bnever\b|rather than|instead of/i.test(x));
    assert.deepEqual(wrong, [], `${name} lets a reader believe the club synchronises`);
    assert.ok(/add-only|add\s+only/i.test(doc), `${name} says the envelope is add-only`);
    assert.ok(/encrypted\s+backup/i.test(doc), `${name} says it is an encrypted backup`);
    assert.ok(/deletion/i.test(doc), `${name} says what happens to a deletion`);
  }
});

// The bounds in sw.js are the only thing between a share sheet and the store.
// A document naming different numbers is documenting a build that is not this
// one, which is how a reader ends up trusting a ceiling that was never there.
test('security names the ceilings the share target actually enforces', () => {
  const caps = /const CAP = \{ url: (\d+), title: (\d+), text: (\d+) \};/.exec(sw);
  assert.ok(caps, 'the worker bounds each field');
  const total = /const CAP_TOTAL = (\d+);/.exec(sw);
  assert.ok(total, 'and bounds the three together');
  for (const n of [caps[1], caps[2], caps[3], total[1]]) {
    assert.ok(new RegExp(`\\b${n}\\b`).test(security), `SECURITY names the ceiling ${n}`);
  }
  assert.ok(/const CAP_BODY = 1024 \* 1024;/.test(sw), 'a body past a megabyte is not parsed');
  assert.ok(/1\s+MB|1024\s*\*\s*1024|one\s+megabyte/i.test(security), 'and SECURITY names that too');

  // the digit in the address is the truth about whether anything was kept
  assert.ok(/kept \? '\?shared=1' : '\?shared=0'/.test(sw), 'the redirect honours the write');
  assert.ok(/shared=1/.test(security) && /shared=0/.test(security),
    'and SECURITY names both digits');
});

// Two devices, one vault. The preconditions are the whole defence.
test('security describes the vault the worker actually implements', () => {
  assert.ok(/if-match/.test(worker), 'the worker requires a precondition');
  assert.ok(/If-Match/.test(security), 'and SECURITY names it');
  assert.ok(/If-None-Match/.test(security), 'and names the create case');
  for (const code of ['412', '428']) {
    assert.ok(new RegExp(`\\b${code}\\b`).test(worker), `the worker answers ${code}`);
    assert.ok(new RegExp(`\\b${code}\\b`).test(security), `and SECURITY names ${code}`);
  }
  // the star form is refused on purpose, and that is a claim worth holding
  assert.ok(/star form of `?If-Match`?: \*` is deliberately not honoured|star form of if-match is deliberately not honoured/i.test(worker),
    'the worker refuses If-Match: *');
  assert.ok(/If-Match:\s*\*` is\s+(deliberately\s+)?not\s+honoured/.test(security),
    'and SECURITY says so');
});

// A claim that cannot be presented again is a key lost to a flat battery. A
// claim anybody can present is a stranger's way into a membership. The shape
// described here is the one that answers both, and SECURITY has to describe
// the one the code actually implements.
test('security describes the join the door actually accepts', () => {
  assert.ok(/tc-join:/.test(club) && /tc-join:/.test(security), 'SECURITY names the label');
  assert.ok(/resonate\.club\.join\.v1/.test(security), 'and where the secret is kept');
  assert.ok(/getRandomValues\(new Uint8Array\(16\)\)/.test(club), 'the secret is 128 bits');
  assert.ok(/128\s+bit/i.test(security), 'and SECURITY says how big it is');
  assert.ok(/checkout\.session\.completed/.test(worker) && /webhook/i.test(security),
    'the membership begins at the webhook, and SECURITY says a lost success page costs nothing');
});

// The old protocol hashed the session id into the claim, filed a claim record
// for a day, and answered 409 to everyone else. Every part of that is gone. A
// document still describing it would be describing a defence this club does
// not have, which is worse than describing none.
test('no document still describes the claim window that was removed', () => {
  for (const [name, doc] of [['SPEC', spec], ['THREATS', threats], ['SECURITY', security],
    ['the club README', clubReadme], ['the README', readme]]) {
    assert.ok(!/tc-claim:/.test(doc), `${name} still names the old claim label`);
    assert.ok(!/claim:<hash>/.test(doc), `${name} still describes a stored claim record`);
  }
  assert.ok(!/tc-claim|CLAIM_TTL|claim:\$\{/.test(worker), 'the worker still carries the old claim');
  assert.ok(!/tc-claim|CLAIM_STORE/.test(club), 'the client still carries the old claim');
});

// The price reaches a surface only when there is a door to pay at. A shut door
// quoting a number is the app naming a sum nobody can hand over; an open door
// that will not say what it costs is worse. This fails in both directions.
test('a shut door quotes no price, and an open one quotes exactly this one', () => {
  const url = /export const CLUB_URL = '([^']*)'/.exec(club)?.[1];
  const price = /export const PRICE = '([^']*)'/.exec(club)?.[1];
  assert.notEqual(url, undefined, 'CLUB_URL is not where it was');
  assert.notEqual(price, undefined, 'PRICE is not where it was');
  const page = read('index.html');
  if (!url) {
    assert.equal(price, '', 'the door is shut and the app names a sum nobody can pay');
    assert.ok(!/\bCHF\b/.test(page), 'the how page quotes a price for a door that does not open');
    assert.ok(!/\bCHF\b/.test(app), 'the club room quotes a price for a door that does not open');
  } else {
    assert.ok(price, 'the door is open and the app will not say what a membership costs');
    assert.ok(/\$\{esc\(PRICE\)\}/.test(app), 'the club room does not quote the configured price');
  }
});

// The switch is two edits in two files, and a green suite used to vouch for
// only one of them. Setting CLUB_URL without widening the policy ships a club
// the browser refuses to call: every request fails at the page's own
// content security policy, before it reaches the network, and the app reports
// it as the club not answering. The two halves are asserted together here so
// that half a switch cannot be merged.
test('an open door is reachable by the policy that ships with it', () => {
  const url = /export const CLUB_URL = '([^']*)'/.exec(club)?.[1];
  assert.notEqual(url, undefined, 'CLUB_URL is not where it was');
  if (!url) return;
  // read the policy out of the meta tag's own content attribute, the way the
  // assertion above it does. scanning the whole document would let a comment
  // that merely mentions connect-src and the club satisfy this, and would fail
  // a correct policy whose comment did not.
  const policy = /content="([^"]*default-src[^"]*)"/.exec(page)?.[1] || '';
  assert.ok(policy, 'there is a policy at all');
  const connect = /connect-src ([^;]*)/.exec(policy)?.[1];
  assert.ok(connect, 'the shipped policy has no connect-src to widen');
  assert.ok(connect.split(/\s+/).includes(url),
    `the door is open at ${url} and connect-src does not name it, so the browser will refuse every call`);
});

// The other half of the same failure, on the worker's side. wrangler.toml
// ships with placeholders where the KV namespace id and the Price id belong,
// and both are edited by hand during the launch and were never required to be
// committed. A door that is open while a placeholder is still in the file
// means the running worker is configured from values that exist nowhere in
// this repository, and nobody else could ever redeploy it.
test('an open door leaves no placeholder in the worker it depends on', () => {
  const url = /export const CLUB_URL = '([^']*)'/.exec(club)?.[1];
  assert.notEqual(url, undefined, 'CLUB_URL is not where it was');
  if (!url) return;
  const toml = read('club/wrangler.toml');
  const left = toml.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /PUT-THE-/.test(line))
    .map(([n, line]) => `club/wrangler.toml:${n}  ${line.trim()}`);
  assert.deepEqual(left, [],
    `the door is open and the worker's own configuration is still a placeholder:\n${left.join('\n')}`);

  // SITE is not a placeholder and so is not caught above, and it is the worst
  // of the three to get wrong. The launch swaps it to localhost twice, for the
  // rehearsal and for the first real purchase, and one of those swaps is
  // committed to a branch on purpose. Left at localhost when the door opens,
  // the worker sends no allowance to any member's browser and returns every
  // payer to an address that exists only on the machine that ran the
  // rehearsal. The deployed worker cannot be asked this from here; the
  // committed file can.
  const site = /^\s*SITE\s*=\s*"([^"]*)"/m.exec(toml)?.[1];
  assert.equal(site, 'https://resonate.select',
    `the door is open and the worker is configured to answer ${site || 'nothing'}`);
});

// The commercial documents are the third place a half-finished switch can
// hide, and the worst of the three. A worker pointed at localhost fails
// loudly the first time anybody presses the button. A terms page that still
// says PUT-THE-LEGAL-NAME-HERE fails nowhere at all: it renders, it reads
// almost right, and the only person who finds it is a buyer looking for who
// took their money.
//
// So the same marker the worker's configuration uses is used here, and the
// same rule applies to it. While the door is shut these may sit unfilled,
// because they are drafted before the facts that go in them are settled. The
// moment CLUB_URL names a club, every one of them has to be a real answer.
test('an open door leaves no placeholder in the documents a buyer reads', () => {
  const url = /export const CLUB_URL = '([^']*)'/.exec(club)?.[1];
  assert.notEqual(url, undefined, 'CLUB_URL is not where it was');
  if (!url) return;

  // read the list out of PAGES rather than repeating it, so a document added
  // to the site is scanned without anybody remembering to add it here
  const marks = read('js/marks.js');
  const block = /export const PAGES = \{([\s\S]*?)\}/.exec(marks)?.[1];
  assert.ok(block, 'PAGES is not where it was in js/marks.js');
  const files = [...block.matchAll(/'([^']+\.md)'/g)].map(m => m[1]);
  assert.ok(files.length >= 7, `PAGES offers ${files.length} documents, which is fewer than it had`);

  const left = [];
  for (const file of files) {
    // SPEC.md is served from the root and kept in club/, the one document
    // whose repository path is not its served path
    const body = read(file === 'SPEC.md' ? 'club/SPEC.md' : file);
    body.split('\n').forEach((line, i) => {
      if (/PUT-THE-/.test(line)) left.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(left, [],
    `the door is open at ${url} and a buyer can read this:\n${left.join('\n')}`);
});

// A sandbox is a fact about the product, not about the deployment.
//
// While TESTING is true the payment desk is Stripe's sandbox: a card typed into
// the door is a test card, nothing is charged, and a membership can be wiped
// without notice. Every document and every surface that describes the club is
// then describing something that has not happened yet, and the one sentence
// that makes the difference is the one a person would act on.
//
// So it is bound in both directions, like the price and like the shut door. A
// sandbox that says nothing is the ordinary failure. A shop that still calls
// itself a test is the same failure facing the other way, and it is worse: the
// day money starts moving, a terms page still promising that no money changes
// hands is a page that contradicts the charge on somebody's statement.
test('a club that takes no money says so, and a club that does says nothing of the kind', () => {
  const testing = /export const TESTING = (true|false);/.exec(club)?.[1];
  assert.notEqual(testing, undefined, 'TESTING is not where it was in js/club.js');
  const sandbox = testing === 'true';

  // These documents are hard-wrapped for the person editing them, so a sentence
  // is a sentence and not a line, and a search for one has to say so. The
  // emphasis goes with it: `**no money changes\nhands**` is the same promise as
  // the one without the stars and must not be findable only by luck of wrapping.
  const flat = (s) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ');
  const said = 'no money changes hands';
  for (const [name, doc] of [['TERMS.md', flat(terms)], ['PRIVACY.md', flat(privacy)]]) {
    assert.equal(doc.includes(said), sandbox, sandbox
      ? `${name} does not say that ${said} while the club is a sandbox`
      : `${name} still says that ${said} for a club that is charging`);
  }

  // and the room a person is standing in when they decide, which is the one
  // surface they cannot avoid on the way to handing over an atlas
  // \s+ rather than a literal space, for the reason the comment above already
  // gives about the documents: a sentence is a sentence and not a run of
  // particular characters. The space between `No` and `money` is a
  // non-breaking one, because this is the largest type in the app and the
  // shortest sentence in it, and `No` alone at the end of a line is a promise
  // that reads as its own opposite for as long as it takes the eye to drop.
  assert.equal(/This is a test\.\s+No\s+money\s+changes\s+hands\./.test(app), sandbox, sandbox
    ? 'the club room takes an atlas without saying the desk is a sandbox'
    : 'the club room calls a paying membership a test');
  assert.equal(/const testingNote = \(\) => \(TESTING \?/.test(app), true,
    'the club room stopped asking TESTING and now decides for itself');

  // A sandbox that quotes no price is fine and a shop that quotes none is not:
  // the price is bound to the door elsewhere, and this only holds the pair that
  // cannot both be true. A club charging real money in a room that calls itself
  // a test is the one combination with a victim.
  if (!sandbox) {
    assert.ok(!/sandbox/i.test(terms), 'TERMS still calls the payment desk a sandbox');
    assert.ok(!/sandbox/i.test(privacy), 'PRIVACY still calls the payment desk a sandbox');
  }
});

// the same wrapping, for the tests below that read a sentence out of a document
const unwrapped = (s) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ');

// The review that is owed, and where it is now read.
//
// The letters protocol is exact RFC 9180 and is checked against the published
// vectors, and neither of those is an outside review. The documents a person is
// sent to for what the club does not promise still say so, and TERMS is pinned
// here because that is the one a member accepts.
//
// The sentence came off the club room and the how page on 17 Aug 2026, by the
// owner's instruction. Those two surfaces now name what the sealing follows and
// say nothing about who has read it. So what is bound is no longer the sentence
// but the pair that cannot both be true: a surface may be quiet about the
// review, and may not claim one the documents say has not happened. Planting
// "independently reviewed" into either surface is what turns this red.
test('no surface claims a review the documents say has not happened', () => {
  assert.match(unwrapped(terms), /has not (?:yet )?been reviewed by anybody outside this project/i,
    'TERMS offers letters without saying who has not checked them');
  // the affirmative shapes only, so that a surface saying plainly that no review
  // has happened stays legal: a denial is never the thing this test is hunting.
  const claim = /(?:independently|externally) (?:reviewed|audited)|has been (?:independently |externally )?(?:reviewed|audited)|(?:independent|outside|external) (?:review|audit) (?:is|has been) (?:complete|completed|done|finished)/i;
  for (const [where, src] of [['the club room', app], ['the how page', page]])
    assert.ok(!claim.test(src), `${where} claims a review TERMS says has not happened`);
});

// The witness exists so that nothing is ever cut in silence. If a bound creeps
// back into an own archive the witness fires, and the document has to be the
// place a person can read that promise before they trust a restore.
test('security states the promise the witness makes about an own archive', () => {
  assert.ok(/const ALL = Infinity;/.test(schema), 'own caps are unbounded');
  assert.ok(/export const OWN = \{[^}]*\}/s.test(schema), 'and they are named together');
  const own = /export const OWN = \{([^}]*)\}/s.exec(schema)[1];
  assert.ok(!/\d/.test(own), 'no number has crept back into an own archive');
  assert.ok(/refused\s+whole/i.test(security), 'SECURITY says a lossy archive is refused, not shortened');
  assert.ok(/witness/i.test(security), 'and names the thing that notices');
});

// The three limits this release did not fix. Saying so is the product.
test('security still states the limits rf67 did not lift', () => {
  // structured records really are still in localStorage, one string each
  assert.ok(/localStorage\.setItem\(key, JSON\.stringify\(value\)\)/.test(store),
    'a collection is written as one string');
  assert.ok(/localStorage/.test(security), 'SECURITY says where records live');
  assert.ok(/whole\s+collection/i.test(security),
    'and that a change rewrites the whole collection');
  assert.ok(/two\s+tabs/i.test(security), 'and that two tabs coordinate only after a write');

  assert.ok(/no\s+independent\s+audit|not\s+been\s+audited|nobody\s+outside/i.test(security),
    'SECURITY says there is no independent audit');
});

// ---------- what a device from before is still holding ----------
//
// Photographs have left the app and not left the devices. Every promise about
// them is now a promise made on behalf of something the app can destroy and
// can no longer show, which is exactly the condition under which a document
// and its code drift apart without anybody noticing.

// A store that would not open is not a store holding nothing, and the two used
// to be folded together at every call site by `|| []`. The sentence a person
// then read was "no snapshot has been taken on this device yet", which is the
// one sentence that stops somebody going to look for a backup they have.
test('a database that would not open is never reported as one holding nothing', () => {
  assert.ok(/export async function snapshotKeys\(\)/.test(read('js/photos.js')),
    'the module still answers the question');
  assert.ok(!/snapshotKeys\(\)\s*\)?\s*\|\|\s*\[\]/.test(app),
    'a call site collapses a refusal into an empty list again');
  assert.ok(/would not open its database/.test(app),
    'and the app has a sentence for the refusal itself');
});

// The one word in the app that destroys somebody's photographs was the one
// word that did not mention them. Both the dialog and the page that explains
// erasing have to name what an erase actually reaches.
test('erasing says it reaches the photographs a device still holds', () => {
  assert.ok(/photoStore\.stageClear\(\)/.test(app), 'an erase empties the photographs store reversibly');
  assert.ok(/photographCount\(\)/.test(app) && /an erase takes/.test(app),
    'and the confirmation counts them and says so');
  assert.ok(/id="eraseAll">erase everything</i.test(app),
    'Settings lost the explicit destructive action');
});

// The notice about photographs can be dismissed by a keypress, so it may never
// be the only route out. A door that stands under `yours` for as long as
// anything is behind it is what makes the notice a courtesy rather than the
// one chance anybody gets.
test('the way out of the photographs is not spent by dismissing a dialog', () => {
  // the marker is written where the matter is settled, and nowhere else
  const offer = /async function offerTheFarewell\([\s\S]*?\n}/.exec(app);
  assert.ok(offer, 'the notice is still raised from one place');
  assert.ok(!/rememberTelling\(\)/.test(offer[0]),
    'a dismissal records the telling again, which retires the offer on a keypress');
  assert.ok(/id="photoWay"/.test(app), 'and a word of its own stands in the you room');
  assert.ok(/photographCount\(\)\.then/.test(app), 'shown only when something is behind it');
});

// A person presses "the backup before this one" to find out what came home.
// The photograph clause used to be a message of its own and it returned where
// it stood, so the one time an older backup carried pictures was the one time
// nobody was told how many records arrived. Both are owed, so both are said.
test('an older backup brought home says how many records came, photographs or not', () => {
  const prev = /\$\('#clubPrev'\)\.addEventListener\([\s\S]*?\n  \}\);/.exec(app);
  assert.ok(prev, 'the backup before this one still has a word of its own');
  const body = prev[0];
  assert.ok(/came home from the backup before this one/.test(body),
    'the sentence that says how many records arrived');
  assert.ok(/photograph/.test(body), 'and the photographs are still named');
  assert.equal((body.match(/toast\(came \+ /g) || []).length, 1,
    'the outcome is one sentence: the photograph clause is added to the count of records');
  assert.ok(!/toast\(`\$\{nPics\}/.test(body),
    'a photograph message of its own returns before the records are ever counted');
});

// The two ways round a file too large to read were written when a person
// could leave the photographs out of an export. There is one export now and
// it is the whole atlas, and the club refuses a sixth of what is refused
// here, so both were directions to somewhere that turns you away again.
test('the refusal of a large file offers no way round it that does not exist', () => {
  const refusal = /reads up to \$\{mb\(ARCHIVE_BYTES\)\} in one go[\s\S]*?\{ yes: 'i see'/.exec(app);
  assert.ok(refusal, 'a file too large to read is still refused out loud');
  assert.ok(!/smaller export/i.test(refusal[0]), 'there is no smaller export to make');
  assert.ok(!/club/i.test(refusal[0]), 'and the club refuses at sixteen million bytes');
  assert.ok(/vaultBytes: 16_000_000/.test(read('club/src/validate.js')),
    'which is the number that makes the second one false');
});

// What this browser keeps, on the page that exists to say so. Photographs are
// not kept by this build and are still held by devices that ran the last one,
// and a page that stops at the snapshots leaves a person believing the app has
// let go of something it is still holding.
test('the page names what a device from before is still holding', () => {
  assert.ok(/id="photoWay" hidden>the photographs still here/i.test(app),
    'Settings lost the conditional route to photographs kept by an older version');
  assert.ok(/Resonate no longer keeps photographs/.test(app),
    'the conditional route does not explain why photographs may still be present');
});

// The figure beside the counts is the browser's estimate for the whole
// address. It was arguable as "how much room your places take" while
// photographs were most of the bytes; the records are small now and what the
// number mostly measures is the app's own offline copy.
test('the room this browser reports is not sold as the size of the atlas', () => {
  assert.ok(/navigator\.storage\?\.estimate/.test(read('js/photos.js')),
    'the figure is the origin estimate, which is what it has always been');
  assert.ok(/mb used on this device/.test(app),
    'so the line beside it says what it is measuring');
  assert.ok(!/how much room they take/.test(page),
    'and the page no longer says the figure is only the records');
});

// Five places answer "what does the club hold about a member", and they drift,
// because prose about a data structure has no compiler. When this was written
// THREATS.md was three fields short, index.html was three short, and
// club/README.md had left out the standing altogether. Each was written
// carefully. Nothing compared them.
//
// So the field names are read out of the record the worker actually writes: a
// seventh field added there reddens this until every surface has words for it.
// The words are looked for inside the one list on each surface and nowhere
// else in the file, because `standing` also appears in the page as "standing
// here", which is the app's own feature and would have made this vacuous.
test('every field the club stores about a member is disclosed on every surface that lists them', () => {
  const record = /const member = \{([\s\S]*?)\n {2}\};/.exec(worker)?.[1];
  assert.ok(record, 'the member record is not where it was in club/src/worker.js');
  const fields = [...record.matchAll(/^ {4}([A-Za-z_$][\w$]*)\s*[:,]/gm)].map((m) => m[1]);
  assert.ok(fields.length >= 6, `only ${fields.length} fields read out of the member record`);

  // one entry per field. the alternatives are the phrasings different surfaces
  // legitimately use for the same thing: the spec says `standing`, the page
  // says what Stripe last said about the subscription, and those are one
  // disclosure written for two readers.
  const said = {
    sub: /subscription id|subscription and billing account ids/i,
    cus: /billing account ids?/i,
    until: /paid-until/i,
    standing: /\bstanding\b|what Stripe last said/i,
    leaving: /notice/i,
    seq: /newest[- ](billing[- ]|payment[- ]|Stripe[- ])?event/i,
  };

  // the one list on each surface. an anchor that moves fails by name rather
  // than quietly widening to the whole file.
  const lists = [
    ['THREATS.md', threats, /Per member:([\s\S]*?)Per request:/],
    ['PRIVACY.md', privacy, /Per member, the membership and backup records are:([\s\S]*?)\n\nThe authoritative/],
    ['club/SPEC.md', spec, /Its state holds([\s\S]*?)\n\n\*\*KV\*\*/],
    ['club/README.md', clubReadme, /about a member, in full:([\s\S]*?)No names/],
  ];

  const wrong = [];
  for (const [name, doc, anchor] of lists) {
    const found = anchor.exec(doc)?.[1];
    assert.ok(found, `the list of what is held is not where it was in ${name}`);
    // a line wrap is not a change of meaning: THREATS.md breaks "billing
    // account id" across two lines, and matching raw text would call that
    // a missing disclosure and send someone to fix what is already right
    const list = found.replace(/\s+/g, ' ');
    for (const f of fields) {
      if (said[f] && !said[f].test(list)) wrong.push(`${name} does not disclose ${f}`);
    }
  }
  // a field nobody has written words for is the whole point, and it fails here
  // rather than passing unnoticed above
  for (const f of fields) {
    if (!said[f]) wrong.push(`the record holds ${f} and no surface has words for it`);
  }
  assert.deepEqual(wrong, [], wrong.join('; '));
});

// `cache.add` fetches the URL it is handed and nothing that URL imports, so the
// precache list is a copy of the module graph maintained by hand. It was one
// name short: js/store.js imports js/canonical.js, store.js was on the list and
// canonical.js was not, and nothing in the repository compared the two.
//
// The worker's own install comment is the argument against that state, and it
// was already written: a shell that cannot be cached whole must not install,
// because activate deletes every other cache. The fetch handler then makes the
// gap fatal rather than slow, on purpose: a missing script is not a navigation,
// so it is answered with Response.error() rather than with the page, and the
// boot dies where it stands.
//
// The runtime cache is why nobody noticed. A controlled online load stores the
// missing module, so the app only breaks for someone who has not had one since
// the current version shipped. The cache is keyed on that version and activate
// deletes every other one, so every release reopens the window.
test('every module the app imports is a module the worker precaches', () => {
  const shell = new Set([...sw.matchAll(/\.\/js\/([\w-]+\.js)/g)].map((m) => m[1]));
  assert.ok(shell.size > 5, `only ${shell.size} modules read out of the shell list in sw.js`);

  // the graph as it is, rather than as a list somewhere says it is: every
  // static import between modules under js/, and who asks for it
  const imported = new Map();
  for (const file of readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js'))) {
    for (const m of read(`js/${file}`).matchAll(/^\s*import[^;]*?from '\.\/([\w-]+\.js)/gm)) {
      if (!imported.has(m[1])) imported.set(m[1], file);
    }
  }
  assert.ok(imported.size > 5, `only ${imported.size} static imports found under js/, so this proves nothing`);

  const missing = [...imported]
    .filter(([name]) => !shell.has(name))
    .map(([name, by]) => `js/${by} imports ${name}, and the worker never caches it`);
  assert.deepEqual(missing, [], missing.join('; '));
});

// The curtain in front of an unfinished document, bound to the reason for it.
//
// TERMS.md and PRIVACY.md are published before they are true: they name a
// seller that is still PUT-THE-LEGAL-NAME-HERE and a price for a club that has
// not opened. They are reachable so the people helping to get them right can
// read them, and js/read.js asks for a word before setting either.
//
// A list of exceptions decays into a list of things somebody forgot, so this
// binds the list to the fact underneath it in both directions: a document with
// a placeholder left in it must be behind the word, and a document with none
// must not be. Filling the last placeholder is then what takes the curtain
// down, rather than remembering to.
//
// What this does not test is that the word protects anything, because it does
// not. The site is static and the file keeps its own address. The test in the
// browser suite states that limit rather than papering over it.
test('a document is kept behind a word for exactly as long as it is unfinished', () => {
  const marks = read('js/marks.js');
  const block = /export const PAGES = \{([\s\S]*?)\}/.exec(marks)?.[1];
  assert.ok(block, 'PAGES is not where it was in js/marks.js');
  const pages = [...block.matchAll(/(\w+): '([^']+\.md)'/g)].map((m) => [m[1], m[2]]);
  assert.ok(pages.length >= 7, `PAGES offers ${pages.length} documents, which is fewer than it had`);

  const list = /export const UNFINISHED = \[([^\]]*)\]/.exec(marks)?.[1];
  assert.notEqual(list, undefined, 'UNFINISHED is not where it was in js/marks.js');
  const behind = new Set([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]));

  const wrong = [];
  for (const word of behind) {
    if (!pages.some(([w]) => w === word)) wrong.push(`${word} is kept behind a word and names no document`);
  }
  for (const [word, file] of pages) {
    // SPEC.md is served from the root and kept in club/, the one document
    // whose repository path is not its served path
    const unfinished = /PUT-THE-/.test(read(file === 'SPEC.md' ? 'club/SPEC.md' : file));
    if (unfinished && !behind.has(word)) wrong.push(`${file} still has a placeholder and anyone can read it`);
    if (!unfinished && behind.has(word)) wrong.push(`${file} has no placeholder left and is still behind a word`);
  }
  assert.deepEqual(wrong, [], wrong.join('; '));
});
