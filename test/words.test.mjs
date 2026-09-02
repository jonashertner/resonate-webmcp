// words.test.mjs — one name for one thing, and no dash a reader can see.
//
// Two vocabularies for a single object is not a style problem. A reader has to
// work out whether a "domain" and a "tag" are different things before they can
// judge anything said about either, and a second word for the classification
// object drifted from the matching engine into the interface twice before this
// test existed. The same happened with "envelope": a metaphor that read well,
// explained nothing, and carried a promise about someone's privacy.
//
// So the words are held down here. This is a plain scan of the source rather
// than of rendered output, which is only sound because the rename was complete:
// if a legitimate use appears later, name it in ALLOWED rather than loosening
// the pattern.
//
// Two of the rules below cannot be answered by a scan of the source at all. A
// link inside a document is only a link once the reader has set it, so those
// documents are rendered here and the anchors are read. And the em-dash rule
// has to know which characters a person actually sees, which is what
// tools/visible.mjs works out; it is called from here so that `npm test` says
// so too, and not only the two workflows that run it as their own step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render, PAGES } from '../js/marks.js';
import { visible, emDashes, surfaces, longWinded, blocksOf, BREATH } from '../tools/visible.mjs';
import { CLUB_URL } from '../js/club.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// the same text with everything a reader cannot see blanked out: the comments
// in a module, the markup comments in a page, nothing at all in a document
const kindOf = (p) => (p.endsWith('.html') ? 'html' : p.endsWith('.js') ? 'js' : 'md');
const shown = (p) => visible(read(p), kindOf(p));

// and the narrower reading: only what a module says out loud, its strings and
// the text of its templates. A rule about a word needs this, because a word
// can hide in an identifier and a punctuation mark cannot.
const spoken = (p) => visible(read(p), kindOf(p), { speech: true });

// everything a person can read, plus the code that produces it
const SURFACES = [
  'index.html', 'js/app.js', 'js/kinship.js', 'js/schema.js', 'js/store.js',
  'js/share.js', 'js/map.js', 'js/route.js', 'js/capture.js',
  'README.md', 'METHOD.md', 'SECURITY.md', 'THREATS.md', 'ASSISTANT-ACCESS.md',
  'TERMS.md', 'PRIVACY.md', 'SUPPORT.md',
];

// the documents the reader sets, at the paths this repository keeps them
const DOCUMENTS = ['club/SPEC.md', 'THREATS.md', 'METHOD.md', 'SECURITY.md', 'ASSISTANT-ACCESS.md',
  'TERMS.md', 'PRIVACY.md', 'SUPPORT.md'];

// a line may say "domain" only when it means an internet address
const ALLOWED = [
  /subdomains/,          // the tile provider's a,b,c,d
];

// every test but this one, which has to say the forbidden word to forbid it
function siblingTests() {
  return readdirSync(join(root, 'test'))
    .filter(f => f.endsWith('.test.mjs') && f !== 'words.test.mjs')
    .map(f => `test/${f}`);
}

function offences(text, pattern) {
  return text.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => pattern.test(line) && !ALLOWED.some(ok => ok.test(line)));
}

test('the classification object is called a tag, and never a domain', () => {
  // The tests are scanned too. The rename swept the source and left four test
  // names and a comment behind, which nothing caught, because a test that is
  // green is a test nobody reads. A stale word there teaches the next reader
  // the wrong vocabulary just as surely as one in the app.
  const found = [];
  for (const file of [...SURFACES, ...siblingTests()]) {
    for (const [n, line] of offences(read(file), /\bdomains?\b/i)) {
      found.push(`${file}:${n}  ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(found, [],
    `"domain" may name an internet address in a technical document. It may never name a tag:\n${found.join('\n')}`);
});

test('the backup is not handed to a reader as an envelope', () => {
  // "envelope" is the right name for the byte format, and the documents that
  // specify that format say it constantly and correctly. It is only jargon
  // when a person who has never read those documents meets it in the app and
  // has to guess what it promises about their privacy. So the rule is placed
  // where the reader is: the page, not the specification behind it.
  //
  // The page was the whole of the rule for one release, and the club room is
  // not on the page. A dialog raised on the way to bringing a backup home
  // told a person, in the middle of a decision about their photographs, that
  // it would write "the whole envelope" to a file. The scan reaches js/app.js
  // for that reason, and it reads only what a person is shown: the word is the
  // right one where this code explains itself to the next person to read it,
  // and the specification behind it goes on saying it throughout.
  const found = [];
  for (const file of ['index.html', 'js/app.js']) {
    for (const [n, line] of offences(shown(file), /\benvelopes?\b/i)) {
      found.push(`${file}:${n}  ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(found, [],
    `a reader must be told what happens, not the name of the format it happens in:\n${found.join('\n')}`);
});

test('the backup is not handed to a reader as a vault', () => {
  // The same rule, and the same leak from the other end. "vault" is the
  // worker's own noun: it is the wire path, the KV prefix, and the word the
  // specification uses for the club's storage, and it is correct in all three.
  // It is nobody's word for their own backup. The club room said it three
  // times, twice in a sentence a person only ever reads because something has
  // already gone wrong ("the vault did not answer"), where a strange noun is
  // the last thing they need.
  //
  // The rule is stated where the reader is, exactly as the one above: the page
  // and the club room, minus their comments. js/club.js is deliberately not
  // scanned. It speaks to /vault, keeps a revision of the vault, and says so;
  // that is the wire, not the reader.
  const found = [];
  for (const file of ['index.html', 'js/app.js']) {
    for (const [n, line] of offences(shown(file), /\bvaults?\b/i)) {
      found.push(`${file}:${n}  ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(found, [],
    `a person has a backup at the club, not a vault:\n${found.join('\n')}`);
});

test('a link says what it leads to, never what the file is called', () => {
  // The trust documents used to be linked by filename: "written at /SPEC.md".
  // A filename is the author's business. It tells a reader nothing about
  // whether the thing behind it is worth pressing, and a screen reader
  // announcing "slash spec dot em dee" announces nothing at all.
  //
  // The page was only half of it. The documents link one another as well, and
  // one of them handed the reader "[/METHOD.md]" pointing at the raw markdown,
  // which is precisely the thing js/read.js exists to prevent. No scan of the
  // source could see it: in the source it is a line of markdown, and it is a
  // link only after the reader has set it. So the documents are rendered here,
  // as a person receives them, and every anchor is read from both ends.
  const found = [];
  for (const file of ['index.html', 'js/app.js']) {
    for (const [n, line] of offences(shown(file), />[^<]*\.md[^<]*</)) {
      found.push(`${file}:${n}  ${line.trim().slice(0, 90)}`);
    }
  }

  // a sixth document added to the reader has to be added here too, or this
  // rule would go quietly blind to it
  assert.deepEqual(
    Object.values(PAGES).map(f => f.toLowerCase()).sort(),
    DOCUMENTS.map(p => p.slice(p.lastIndexOf('/') + 1).toLowerCase()).sort(),
    'the reader sets a document this rule never looks at');

  for (const doc of DOCUMENTS) {
    for (const [, href, words] of render(read(doc)).matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)) {
      if (/\.md\b/i.test(words)) found.push(`${doc}  a link is labelled with a filename: ${words}`);
      if (/\.md(\?|#|$)/i.test(href)) found.push(`${doc}  a link hands over the raw file: ${href}`);
    }
  }

  assert.deepEqual(found, [],
    `a filename reached the reader:\n${found.join('\n')}`);
});

test('the records this app arrives with are never called a sample', () => {
  // For a long time the rule here was that this flag had exactly one name on
  // the surface, "sample", because a release had arrived calling it "on loan"
  // and the owner, who built the thing, had to ask what it meant.
  //
  // On 2026-08-11 the owner retired the name itself: the records this app
  // arrives with are real places from real people. They travel like any other
  // record, and no surface calls them a specimen of anything. So the rule
  // keeps its shape and changes its list: the metaphors stay forbidden and the
  // word joins them.
  //
  // Three times before this, the rule was one place behind what it forbade:
  // the surfaces, then the phrasing, then the file list. A document is a
  // surface. It is set as a page and read by the same person. The word may
  // stand in a comment, where it is explaining the rule to the next person to
  // read the code, and never on a surface.
  const RETIRED = /\bsamples?\b|\bspecimens?\b|\bdemonstration\b|\bloans?\b|\bborrowed\b|\bloaned\b|\blending\b/i;
  const found = [];
  // every surface, not a chosen few: demoData() alone is several hundred lines
  // of copy a person reads, and it lives in a module this rule never opened
  for (const [file, kind] of surfaces()) {
    for (const [n, line] of offences(visible(read(file), kind, { speech: kind === 'js' }), RETIRED)) {
      found.push(`${file}:${n}  ${line.trim().slice(0, 90)}`);
    }
  }
  // A verb is a word a person types and reads back, and the speech reading
  // cannot see it: it is an object key, which is code. The palette printed
  // "> sample" and "> specimen" through the whole release that retired the
  // word, with this rule green. Keys are read from the source directly, the
  // way the retired-verb rule below already reads them.
  for (const [n, line] of offences(read('js/app.js'), /^\s*(samples?|specimens?|demonstration)\s*:\s*\{\s*run:/i)) {
    found.push(`js/app.js:${n}  a palette verb says it: ${line.trim().slice(0, 60)}`);
  }
  assert.deepEqual(found, [],
    `the atlas this app arrives with is real, and these lines still call it a sample:\n${found.join('\n')}`);
});

test('the newsstand stayed gone', () => {
  // Closed on 2026-08-11: this app is the loop between people who know each
  // other, and a public ranked feed is a different product wearing the same
  // coat. The word may appear in a comment explaining history, never on a
  // surface, and no fetch may reach for the commons address again.
  //
  // Two holes, found by reading the shipped page rather than the rule. The
  // first: this said "newsstand", and what the how page still said was "a
  // folio already on the stand", so a person was told that erasing could not
  // reach a copy on a shelf that had been taken down, in the same release
  // that took it down. The second: three files were scanned, and the two
  // modules that can actually reach an address, js/club.js and sw.js, were
  // not among them. Both are answered the same way, by asking the project's
  // own list of surfaces instead of naming a few.
  for (const [file, kind] of surfaces()) {
    const text = visible(read(file), kind);
    assert.equal(/newsstand|\bthe stand\b/i.test(text), false,
      `${file} still shows the newsstand to a reader`);
  }
  for (const [file] of surfaces()) {
    assert.equal(/resonate-commons/.test(read(file)), false,
      `${file} still reaches for the commons address`);
  }
});

test('the club says the exact thing at least once', () => {
  // "locked" is understandable and "encrypted" is the claim. a person deciding
  // whether to trust this needs the word that can be checked.
  const page = read('index.html');
  assert.match(page, /encrypted backup/i, 'the how page names the encryption');
  assert.match(page, /recovery phrase/i, 'and calls the phrase what it is');
  assert.match(read('js/app.js'), /recovery phrase/i, 'and so does the club room');
});

test('the how page does not sell a door that is shut', () => {
  // The club room reads CLUB_URL and says "The door is not open yet" when it
  // is empty. The how page said nothing of the kind, and carried fourteen
  // lines of present-tense membership: what happens when you stop paying, what
  // Stripe sees, what it costs to hold a backup month after month. All of it
  // true of the thing being built and none of it purchasable, which is a sales
  // page for a service that does not answer.
  //
  // The sentence is required while the door is shut and forbidden once it
  // opens, because a page still saying it on the day the door opens is the
  // same defect facing the other way.
  const shut = /the door is not open yet/i.test(read('index.html'));
  assert.equal(shut, !CLUB_URL, CLUB_URL
    ? 'the door is open and the how page still says it is not'
    : 'the how page sells a membership that cannot be bought, and never says so');
});

test('the thing that answers a search has a name', () => {
  // The app used to personify the geocoder: it asked "the world" what was
  // here, "the world" called a place something, "the world" did not answer.
  // Two lines away the same service was named out loud, in "ask openstreetmap",
  // so one thing had two names and only the vaguer one reached the surface.
  // A person deciding whether to trust a search cannot look up "the world".
  //
  // The patterns were written from the sentences that were being removed, so
  // they knew one tense and one person: they matched "ask the world" and "the
  // world did not answer", and the how page went on saying "the app asks the
  // world once" and "if the world does not answer" for as long as the test was
  // green. They are written from the shape now, and not from the examples.
  //
  // "inks the world" survives on purpose. Pressing a tag colours the map field
  // by it, so there the world is the ground you are looking at, not an agent
  // that can be asked or can decline. Only the verbs of speaking and knowing
  // are held down, for that reason; if the field ever needs one of them, name
  // the line in ALLOWED rather than widening the exception.
  const said = [
    /\b(?:ask|asks|asked|asking|query|queries|queried|tell|tells|telling|told)\s+the world\b/i,
    /\bthe world\b\s+(?:(?:did|does|do|will|would|can|could|cannot|has|have|had|is|was)\s+(?:not\s+|n't\s+)?)?(?:answers?|answered|says?|said|calls?|called|knows?|knew|names?|named|tells?|told|replies|replied|declines?|declined|shrugs?|shrugged|no name)\b/i,
  ];
  const found = [];
  for (const file of ['index.html', 'js/app.js']) {
    for (const shape of said) {
      for (const [n, line] of offences(shown(file), shape)) {
        found.push(`${file}:${n}  ${line.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(found, [],
    `openstreetmap is personified instead of named:\n${found.join('\n')}`);
});

test('the matching method claims only what it counts', () => {
  // it counts how often a tag name appears, which is not fluency: the engine
  // once said "domains you are both fluent in", which asserts a competence
  // nobody measured. Denying the claim is fine and METHOD.md does exactly that
  // ("not whether you are expert in anything"), so only the word that was
  // making the claim is held down here.
  for (const file of ['METHOD.md', 'js/kinship.js', 'index.html', 'js/app.js']) {
    assert.equal(/\bfluen(t|cy)\b/i.test(read(file)), false,
      `${file} calls a word count fluency`);
  }
  assert.match(read('METHOD.md'), /not whether you are expert/i,
    'and METHOD.md still says out loud what the count is not');
});

test('no em-dash reaches a reader, on any surface', () => {
  // The house rule is absolute and it used to be a grep over seven documents,
  // which is the seven files where an em-dash was least likely to appear. The
  // copy is in the modules: every toast, every question, every poster body.
  // What counts as copy in a module is worked out in tools/visible.mjs, and
  // both workflows run the same file as their own step.
  const found = emDashes();
  assert.deepEqual(found, [],
    `an em-dash is in the copy a reader sees:\n${found.join('\n')}`);
});

test('no surface explains itself past a breath', () => {
  // The same mechanism as the em-dash rule and the button budget, applied to
  // the thing that actually grew: not the number of words on a surface but the
  // length of each one. Every sentence that was cut to reach these numbers was
  // a true sentence answering a real question, which is exactly why a diet
  // without a gate is undone within a release.
  //
  // The numbers live in tools/visible.mjs beside the reasoning, and they are a
  // ratchet. Lowering one is a commit that says what came out. Raising one is
  // this test going green on the wall it exists to prevent, and the only honest
  // way to do it is to raise it here, in this file, on purpose.
  const found = longWinded();
  assert.deepEqual(found, [],
    `a surface explains itself at length:\n${found.join('\n')}`);

  // and the gate is not vacuous: it has to see a wall put in front of it, in
  // the shape each surface actually writes one. A module says its copy inside a
  // template, so that is where the planted wall goes.
  for (const [file, kind] of [['index.html', 'html'], ['js/app.js', 'js']]) {
    const markup = `<p class="x">${'word '.repeat(200)}</p>`;
    const blocks = blocksOf(kind === 'js' ? `const x = \`${markup}\`;` : markup, kind);
    assert.equal(blocks.length, 1, `${file}: the scan does not see a block at all`);
    assert.ok(blocks[0].text.length > BREATH[file],
      `${file}: a thousand characters is inside its breath`);
  }

  // a leaf is what is measured: a section holding paragraphs is not counted as
  // one long block, because a person does not meet it as one
  const nested = blocksOf('<div class="s"><p>one</p><p>two</p></div>', 'html');
  assert.deepEqual(nested.map(b => b.text), ['one', 'two'],
    'the scan counts a section as a single block');

  // and a substitution is not prose: its length belongs to the record it
  // carries, not to the sentence around it
  const said = blocksOf('const x = `<p class="a">a place, ${esc(place.note)}</p>`;', 'js');
  assert.deepEqual(said.map(b => b.text), ['a place,'],
    'the scan counts what a substitution might hold as words somebody wrote');
});

test('assistant access and place proposals say exactly what the person controls', () => {
  const app = spoken('js/app.js');
  assert.match(app, /Let assistants work with records included in sharing\./);
  assert.match(app, /exact locations, addresses, notes, links, tags, and recommendation names and dates\./);
  assert.match(app, /They can open items and prepare places or collections\./);
  assert.match(app, /They cannot read excluded records or your People list, and cannot save, delete, share, or mark visits\./);
  assert.match(app, /Access stays on in this browser until you stop it\./);
  assert.doesNotMatch(app, /Only you can save, delete, share, or mark visits|Excluded records are not exposed/,
    'assistant copy must describe Resonate tools, not claim control over every browser agent');
  for (const label of ['Allow access', 'Review assistant copy', 'Read data contract']) {
    assert.match(app, new RegExp(label));
  }
  assert.equal((app.match(/Add to my atlas/g) || []).length, 2,
    'the two place-proposal paths do not offer the same clear action');
  assert.equal((app.match(/Added as Want to go\./g) || []).length, 2,
    'the two place-proposal paths do not report the same saved state');
  assert.doesNotMatch(app, /keep and make it true|kept(?: as want to go)?\. make it true/i);
});

test('sharing exclusions name their exact boundary and keep backups distinct', () => {
  const app = spoken('js/app.js');
  for (const exact of [
    'Excluded from sharing',
    'Exclude from sharing',
    'Include in sharing',
    'Excluded from links, shared files, direct messages, print, and assistant access. Included in private backups.',
    'Start and end hidden when shared',
    'Hide first and last 250 m when sharing',
    'Share full path',
    'All items are excluded from sharing. Open an item and choose Include in sharing.',
  ]) assert.match(app, new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.doesNotMatch(app,
    /this one never leaves the device|this path never leaves the device|keep it off every link|allow sharing again|let it travel again|kept out of every link, collection, and file/i);
  assert.match(read('ASSISTANT-ACCESS.md'),
    /Excluded from links, shared files, direct messages, print, and assistant access\. Included in private backups\./);
  assert.match(read('SUPPORT.md'), /included in private\s+backups/i);
});

test('the short guide stays short', () => {
  const page = read('index.html');
  const start = page.indexOf('id="howOverlay"');
  const end = page.indexOf('id="reportOverlay"');
  assert.ok(start >= 0 && end > start, 'the short guide is not where the shell expects it');
  const words = page.slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 260,
    `the short guide has ${words.length} words; 260 is the ceiling. Put detail in the linked documents.`);
});

// ---------- the button budget ----------
//
// The reduction of August 2026 took the index from seven words to four and
// the export row from eight words to two, and a reduction that is not pinned
// grows back one reasonable button at a time. This is the same mechanism as
// the em-dash rule: the number is law, and raising it is a deliberate act in
// this file rather than a side effect of shipping a feature.
//
// Only what node can see is counted here: the static shell. The surfaces that
// render at runtime (yours, the share panel) are counted in the browser suite,
// where they actually exist.

test('the surface does not grow back: the static shell', () => {
  const page = read('index.html');
  const buttons = (page.match(/<button/g) || []).length;
  // Raised from 45 to 47 on 2026-08-16 for the letters room, and cut to 45 on
  // 2026-08-19 when that room was folded into contacts: the word on the board
  // and the close on the room it opened both went, and the ceiling had been
  // sitting a full three above the real count, which is slack a shell grows
  // into without anybody deciding anything.
  //
  // The number is the count, not a cushion. Every addition is meant to be an
  // argument somebody makes out loud, and a budget with room in it is a budget
  // that never asks.
  //
  // 45 to 43 on 2026-08-19, when the index board went from five words to three,
  // and 43 to 44 in the same release, when the first-run screen grew `bring a
  // club backup home`. The argument for the fourth is written beside it in
  // index.html: a member on a new device had no way to their paid backup that
  // did not begin by pretending to begin.
  //
  // 44 to 45 in rf144: search became a real mobile sheet, and the added close
  // word is its visible way out. Clicking empty backdrop was undiscoverable on
  // a screen the sheet covers, and Escape does not exist on a phone.
  //
  // 45 to 46 in rf156: the one pre-consent assistant tool may only open a
  // zero-data review. Its Allow access control therefore belongs on that
  // dedicated review surface rather than borrowing the broader Settings
  // switch and materialising private settings before consent.
  assert.ok(buttons <= 46,
    `the static shell holds ${buttons} buttons; the budget is 46. `
    + 'If this is deliberate, raise the number here and say why in the commit.');

  // Three. Collections are curated things, people hold provenance, and
  // settings holds the device and its privacy.
  //
  // Five stood here for two days. `club` was added on 2026-08-16 because the
  // travellers club was four presses from the front and nothing on the board
  // said it existed; `how` had stood since the beginning. Both are gone on
  // 2026-08-19, and the argument is that neither was a kind of thing. A club is
  // a facility inside `you` and a manual is a document about the app, and a
  // board whose job is to name the parts of a person's atlas should name three
  // parts, not three parts and two of my concerns.
  //
  // The distance the club word complained about was answered where it actually
  // lived: `the travellers club` is the second section of the settings room
  // now, under the byline, reachable without scrolling. Pinned in the browser
  // suite, because it is a fact about a rendered room.
  const nav = (page.match(/data-go="/g) || []).length;
  assert.equal(nav, 3,
    `the index nav holds ${nav} words; it is collections, people, settings`);

  // and the three are these three: a swap is as much a decision as an addition
  for (const word of ['data-go="folio"', 'data-go="contacts"', 'data-go="you"']) {
    assert.ok(page.includes(word), `${word} left the nav`);
  }

  // and none of them is conditional, which is the whole of what three buys.
  //
  // This assertion used to run the other way. It named `club` and `letters` and
  // demanded that each be written `hidden`, because each stood only for a
  // device that had got somewhere first: a club to reach, an identity to write
  // with. Both are gone, and the board no longer holds a word whose meaning
  // depends on what the reader has already bought. A board that changes shape
  // under you is a board you cannot learn, so the claim is now that every word
  // on it is there for everybody, every time.
  for (const m of page.matchAll(/<button data-go="[^"]+"[^>]*>/g)) {
    assert.ok(!/\bhidden\b/.test(m[0]),
      `a word on the index board is conditional: ${m[0]}. `
      + 'Three words, all unconditional, is the design; a hidden one means the '
      + 'board reads differently to two people and has to be argued for.');
  }
});

// Bold is how this app points. It is the only markup in the prose that says
// "that thing, over there, by that name", so a bolded name has to be a name
// something still answers to.
//
// Three of them were stale on the morning this was written, and all three had
// survived a full sweep and a green suite: `Export a file from <b>yours</b>`
// and `keep an export under <b>yours</b>` were left by the board going to three
// words, and `waits under <b>letters</b>` had been left three days earlier by
// voices and letters becoming contacts. Two were found by reading a screenshot.
// A room can be renamed with confidence; the sentences that send people to it
// are what actually rots, and nothing was watching them.
//
// The labels are read out of the app rather than listed here, so this gate
// cannot go stale in the direction the prose does. index.html contributes its
// board and its buttons but not its section headings, because those headings
// are the how page's own prose: letting them count would have let
// `<b>letters</b>` be validated by the paragraph it stood in.
const NOT_A_LABEL = [];

test('a bolded word is a name something still answers to', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const labels = new Set();
  const add = (text, re) => { for (const m of text.matchAll(re)) labels.add(m[1].trim().toLowerCase()); };
  add(html, /data-go="([a-z]+)"/g);
  add(html, /class="go-word">([^<]+)</g);
  add(html, /class="poster-word">([^<]+)</g);
  add(html, /<button[^>]*>([^<$]+)<\/button>/g);
  add(app, /class="sec-head">([^<$]+)</g);
  add(app, /<button[^>]*>([^<$]+)<\/button>/g);

  // What counts as a pointer rather than emphasis: all lower case, no markup,
  // no interpolation, and short enough to be a name. `<b>Stripe</b>` and
  // `<b>This is a test, and no money changes hands.</b>` are neither.
  const found = [];
  for (const file of ['index.html', 'js/app.js']) {
    for (const [n, line] of read(file).split('\n').map((l, i) => [i + 1, l])) {
      for (const m of line.matchAll(/<b>([^<]{1,30})<\/b>/g)) {
        const word = m[1];
        if (!/^[a-z][a-z ]*$/.test(word) || word.split(' ').length > 3) continue;
        if (NOT_A_LABEL.includes(word) || labels.has(word)) continue;
        found.push(`${file}:${n}  <b>${word}</b>`);
      }
    }
  }
  assert.deepEqual(found, [],
    'the prose points at a name no board word, section heading or button '
    + `answers to:\n${found.join('\n')}\n`
    + 'Either the thing was renamed and this sentence was not, or the word is '
    + `emphasis rather than a pointer and belongs in NOT_A_LABEL.`);
});

// The same rot, in the documents, where the bold rule above cannot reach it:
// six of these were still shipping after the app itself had been swept, in
// TERMS, PRIVACY, THREATS, README, ASSISTANT-ACCESS and the club's own readme.
// Those are the pages a person reads when they are deciding whether to pay, so
// a sentence in them pointing at a room that no longer exists is worse than the
// same sentence in the app, not better.
//
// One word, because one word is what went. `yours` stays an ordinary English
// word on every one of these surfaces and always did: "anything you touched is
// yours and stays", "it is yours and not ours". What it may not be is a name in
// bold or italics, which everywhere in this repository means "that thing, over
// there, by that name".
test('no surface or document sends a reader to a room called yours', () => {
  const found = [];
  for (const file of [...SURFACES, 'club/SPEC.md', 'club/README.md']) {
    for (const [n, line] of read(file).split('\n').map((l, i) => [i + 1, l])) {
      if (/\*\*yours\*\*|\*yours\*|<b>yours<\/b>|<i>yours<\/i>/.test(line)) {
        found.push(`${file}:${n}  ${line.trim().slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(found, [],
    'the index board has had no word `yours` since 2026-08-19; the room is `you` '
    + `and its sections are what a sentence should name:\n${found.join('\n')}`);
});

// and the exception list is not a place things go to be forgotten
test('nothing is excused from the bold rule that has left the prose', () => {
  const text = read('index.html') + read('js/app.js');
  for (const word of NOT_A_LABEL) {
    assert.ok(text.includes(`<b>${word}</b>`),
      `NOT_A_LABEL still excuses <b>${word}</b>, which no surface writes any more`);
  }
});

test('a word that leaves the nav still answers when typed', () => {
  // the nav shrank; the app did not. every retired word keeps its verb, so a
  // person who knew the old surface is never stranded.
  const verbs = read('js/app.js');
  for (const verb of ['census:', 'club:', 'how:', 'yours:', 'voices:', 'letters:']) {
    assert.ok(verbs.includes(verb), `the palette lost the ${verb.replace(':', '')} verb`);
  }
});
